import { execFile } from "node:child_process";
import { copyFile, mkdtemp, rm } from "node:fs/promises";
import { createDecipheriv, pbkdf2Sync } from "node:crypto";
import { existsSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { createHash } from "node:crypto";
import type { Session } from "electron";
import { isSignedInServiceHost } from "@bb/desktop-contract";

const run = promisify(execFile);

// The in-app browser runs on its own Electron session, so a Google or Figma
// link opens there signed out even though the same machine is signed in
// through Chrome. Google refuses sign-in from an embedded browser, so the
// session cannot be filled by asking the user to log in again: the working
// path is to carry the cookies Chrome already holds into that session.
const CHROME_COOKIE_PATHS = [
  "Library/Application Support/Google/Chrome Beta/Default/Cookies",
  "Library/Application Support/Google/Chrome/Default/Cookies",
  ".config/google-chrome/Default/Cookies",
  ".config/google-chrome-beta/Default/Cookies",
];
const CHROME_KEYCHAIN_SERVICE = "Chrome Safe Storage";
const CHROME_KDF_SALT = "saltysalt";
const CHROME_KDF_ITERATIONS = 1003;
const CHROME_KDF_KEY_LENGTH = 16;
const CHROME_CIPHER_IV = Buffer.alloc(16, " ");
// Chrome stores expiry in microseconds since 1601; Electron wants seconds
// since 1970.
const WINDOWS_TO_UNIX_EPOCH_SECONDS = 11_644_473_600;
const RESYNC_INTERVAL_MS = 10 * 60 * 1000;

export interface ChromeCookieRow {
  host_key: string;
  name: string;
  encrypted_hex: string;
  path: string;
  is_secure: number;
  is_httponly: number;
  expires_utc: number;
  samesite: number;
}

export interface SignedInCookie {
  url: string;
  name: string;
  value: string;
  domain: string;
  path: string;
  secure: boolean;
  httpOnly: boolean;
  expirationDate?: number;
  sameSite: "no_restriction" | "lax" | "strict";
}

export function chromeCookieDatabasePath(home = homedir()): string | null {
  for (const relative of CHROME_COOKIE_PATHS) {
    const candidate = join(home, relative);
    if (existsSync(candidate)) {
      return candidate;
    }
  }
  return null;
}

export function deriveChromeKey(safeStoragePassword: string): Buffer {
  return pbkdf2Sync(
    safeStoragePassword,
    CHROME_KDF_SALT,
    CHROME_KDF_ITERATIONS,
    CHROME_KDF_KEY_LENGTH,
    "sha1",
  );
}

// Chrome 127 and later prefix the plaintext with sha256 of the cookie's host,
// so the prefix is recognised by that digest rather than by "the start looks
// like text": a value that genuinely begins with 32 letters would otherwise be
// truncated and silently carry the wrong session.
export function decryptChromeCookieValue(
  encrypted: Buffer,
  key: Buffer,
  host: string,
): string | null {
  if (encrypted.length === 0) {
    return "";
  }
  const version = encrypted.subarray(0, 3).toString("ascii");
  if (version !== "v10" && version !== "v11") {
    return encrypted.toString("utf8");
  }
  let plain: Buffer;
  try {
    const decipher = createDecipheriv("aes-128-cbc", key, CHROME_CIPHER_IV);
    decipher.setAutoPadding(true);
    plain = Buffer.concat([
      decipher.update(encrypted.subarray(3)),
      decipher.final(),
    ]);
  } catch {
    return null;
  }
  const hostDigest = createHash("sha256").update(host, "utf8").digest();
  if (
    plain.length >= hostDigest.length &&
    plain.subarray(0, hostDigest.length).equals(hostDigest)
  ) {
    plain = plain.subarray(hostDigest.length);
  }
  const text = plain.toString("utf8");
  return text.includes("�") ? null : text;
}

export function toSignedInCookie(
  row: ChromeCookieRow,
  key: Buffer,
): SignedInCookie | null {
  const value = decryptChromeCookieValue(
    Buffer.from(row.encrypted_hex, "hex"),
    key,
    row.host_key,
  );
  if (value === null) {
    return null;
  }
  const bareHost = row.host_key.replace(/^\./u, "");
  const scheme = row.is_secure === 1 ? "https" : "http";
  const sameSite =
    row.samesite === 2 ? "strict" : row.samesite === 1 ? "lax" : "no_restriction";
  const expiration =
    row.expires_utc > 0
      ? row.expires_utc / 1_000_000 - WINDOWS_TO_UNIX_EPOCH_SECONDS
      : undefined;
  return {
    url: `${scheme}://${bareHost}${row.path}`,
    name: row.name,
    value,
    domain: row.host_key,
    path: row.path,
    secure: row.is_secure === 1,
    httpOnly: row.is_httponly === 1,
    ...(expiration === undefined ? {} : { expirationDate: expiration }),
    sameSite,
  };
}

async function readChromeSafeStorageKey(): Promise<Buffer | null> {
  if (process.platform !== "darwin") {
    return null;
  }
  try {
    const { stdout } = await run(
      "/usr/bin/security",
      ["find-generic-password", "-w", "-s", CHROME_KEYCHAIN_SERVICE],
      { timeout: 15_000 },
    );
    const password = stdout.trim();
    return password.length === 0 ? null : deriveChromeKey(password);
  } catch {
    return null;
  }
}

async function readChromeCookieRows(
  databasePath: string,
): Promise<ChromeCookieRow[]> {
  // Chrome keeps the database open, and reading it live returns "database is
  // locked" often enough to look like "no cookies". A copy is read instead.
  const scratch = await mkdtemp(join(tmpdir(), "bb-signed-in-"));
  const copyPath = join(scratch, "Cookies");
  try {
    await copyFile(databasePath, copyPath);
    const { stdout } = await run(
      "/usr/bin/sqlite3",
      [
        "-json",
        "-readonly",
        copyPath,
        "select host_key, name, hex(encrypted_value) as encrypted_hex, path," +
          " is_secure, is_httponly, expires_utc, samesite from cookies",
      ],
      { timeout: 30_000, maxBuffer: 64 * 1024 * 1024 },
    );
    const trimmed = stdout.trim();
    if (trimmed.length === 0) {
      return [];
    }
    return JSON.parse(trimmed) as ChromeCookieRow[];
  } catch {
    return [];
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
}

// Only the services the user works in under their own account are carried
// over. The cookie jar holds their whole browsing life, and none of the rest
// has any business in bb's session.
export function selectServiceRows(rows: ChromeCookieRow[]): ChromeCookieRow[] {
  return rows.filter((row) => isSignedInServiceHost(row.host_key.replace(/^\./u, "")));
}

export interface SyncSignedInSessionResult {
  applied: number;
  skipped: number;
  source: string | null;
}

export async function syncSignedInSession(
  session: Pick<Session, "cookies">,
): Promise<SyncSignedInSessionResult> {
  const databasePath = chromeCookieDatabasePath();
  if (databasePath === null) {
    return { applied: 0, skipped: 0, source: null };
  }
  const key = await readChromeSafeStorageKey();
  if (key === null) {
    return { applied: 0, skipped: 0, source: databasePath };
  }
  const rows = selectServiceRows(await readChromeCookieRows(databasePath));
  let applied = 0;
  let skipped = 0;
  for (const row of rows) {
    const cookie = toSignedInCookie(row, key);
    if (cookie === null) {
      skipped += 1;
      continue;
    }
    try {
      await session.cookies.set(cookie);
      applied += 1;
    } catch {
      skipped += 1;
    }
  }
  return { applied, skipped, source: databasePath };
}

export interface SignedInSessionKeeper {
  ensureFresh: () => Promise<boolean>;
  stop: () => void;
}

// The session is refreshed on a timer and before a service tab opens: Google
// rotates these cookies, and a jar filled once at startup goes stale mid-day
// without any visible failure until a document shows the login form again.
export function createSignedInSessionKeeper(args: {
  session: Pick<Session, "cookies">;
  now?: () => number;
  sync?: (
    session: Pick<Session, "cookies">,
  ) => Promise<SyncSignedInSessionResult>;
  onResult?: (result: SyncSignedInSessionResult) => void;
}): SignedInSessionKeeper {
  const now = args.now ?? Date.now;
  const sync = args.sync ?? syncSignedInSession;
  let lastSyncAt = 0;
  let lastApplied = 0;
  let inFlight: Promise<boolean> | null = null;
  let stopped = false;

  async function refresh(): Promise<boolean> {
    const result = await sync(args.session);
    lastSyncAt = now();
    lastApplied = result.applied;
    args.onResult?.(result);
    return result.applied > 0;
  }

  return {
    async ensureFresh() {
      if (stopped) {
        return lastApplied > 0;
      }
      if (lastSyncAt !== 0 && now() - lastSyncAt < RESYNC_INTERVAL_MS) {
        return lastApplied > 0;
      }
      inFlight ??= refresh().finally(() => {
        inFlight = null;
      });
      return inFlight;
    },
    stop() {
      stopped = true;
    },
  };
}
