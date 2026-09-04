import { createCipheriv, createHash, pbkdf2Sync } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  createSignedInSessionKeeper,
  decryptChromeCookieValue,
  deriveChromeKey,
  selectServiceRows,
  toSignedInCookie,
  type ChromeCookieRow,
} from "../src/signed-in-session.js";

const KEY = deriveChromeKey("test-password");

function seal(plain: Buffer): Buffer {
  const cipher = createCipheriv("aes-128-cbc", KEY, Buffer.alloc(16, " "));
  return Buffer.concat([
    Buffer.from("v10", "ascii"),
    cipher.update(plain),
    cipher.final(),
  ]);
}

function row(overrides: Partial<ChromeCookieRow> = {}): ChromeCookieRow {
  return {
    host_key: ".google.com",
    name: "SID",
    encrypted_hex: seal(
      Buffer.concat([
        createHash("sha256").update(".google.com", "utf8").digest(),
        Buffer.from("session-value", "utf8"),
      ]),
    ).toString("hex"),
    path: "/",
    is_secure: 1,
    is_httponly: 1,
    expires_utc: 13_400_000_000_000_000,
    samesite: -1,
    ...overrides,
  };
}

describe("decryptChromeCookieValue", () => {
  it("drops the host digest Chrome prefixes the value with", () => {
    const sealed = seal(
      Buffer.concat([
        createHash("sha256").update(".google.com", "utf8").digest(),
        Buffer.from("session-value", "utf8"),
      ]),
    );
    expect(decryptChromeCookieValue(sealed, KEY, ".google.com")).toBe(
      "session-value",
    );
  });

  it("keeps a value that merely starts with 32 characters", () => {
    const value = `${"a".repeat(32)}session-value`;
    expect(
      decryptChromeCookieValue(seal(Buffer.from(value, "utf8")), KEY, ".google.com"),
    ).toBe(value);
  });

  it("does not strip another host's digest", () => {
    const sealed = seal(
      Buffer.concat([
        createHash("sha256").update(".notion.so", "utf8").digest(),
        Buffer.from("x", "utf8"),
      ]),
    );
    expect(decryptChromeCookieValue(sealed, KEY, ".google.com")).not.toBe("x");
  });

  it("returns null when the key is wrong instead of writing garbage", () => {
    const otherKey = pbkdf2Sync("other", "saltysalt", 1003, 16, "sha1");
    const sealed = seal(Buffer.from("session-value", "utf8"));
    expect(decryptChromeCookieValue(sealed, otherKey, ".google.com")).toBeNull();
  });
});

describe("toSignedInCookie", () => {
  it("maps a Chrome row onto an Electron cookie", () => {
    const cookie = toSignedInCookie(row(), KEY);
    expect(cookie).toMatchObject({
      url: "https://google.com/",
      name: "SID",
      value: "session-value",
      domain: ".google.com",
      secure: true,
      httpOnly: true,
      sameSite: "no_restriction",
    });
    expect(cookie?.expirationDate).toBeCloseTo(1755526400, 0);
  });

  it("uses http for a cookie that is not secure", () => {
    expect(toSignedInCookie(row({ is_secure: 0 }), KEY)?.url).toBe(
      "http://google.com/",
    );
  });

  it("leaves a session cookie without an expiry", () => {
    expect(
      toSignedInCookie(row({ expires_utc: 0 }), KEY)?.expirationDate,
    ).toBeUndefined();
  });
});

describe("selectServiceRows", () => {
  it("keeps the services the user signs into and nothing else", () => {
    const rows = [
      row({ host_key: ".google.com" }),
      row({ host_key: "docs.google.com" }),
      row({ host_key: ".www.figma.com" }),
      row({ host_key: "bank.example.com" }),
      row({ host_key: "google.com.phish.ru" }),
    ];
    expect(selectServiceRows(rows).map((entry) => entry.host_key)).toEqual([
      ".google.com",
      "docs.google.com",
      ".www.figma.com",
    ]);
  });
});

describe("createSignedInSessionKeeper", () => {
  const session = { cookies: {} } as never;

  it("refreshes once and then answers from the last run", async () => {
    const sync = vi.fn().mockResolvedValue({ applied: 3, skipped: 0, source: "x" });
    let clock = 1000;
    const keeper = createSignedInSessionKeeper({
      session,
      now: () => clock,
      sync,
    });
    expect(await keeper.ensureFresh()).toBe(true);
    clock += 60_000;
    expect(await keeper.ensureFresh()).toBe(true);
    expect(sync).toHaveBeenCalledTimes(1);
  });

  it("refreshes again once the cookies could have rotated", async () => {
    const sync = vi.fn().mockResolvedValue({ applied: 2, skipped: 0, source: "x" });
    let clock = 1000;
    const keeper = createSignedInSessionKeeper({
      session,
      now: () => clock,
      sync,
    });
    await keeper.ensureFresh();
    clock += 11 * 60 * 1000;
    await keeper.ensureFresh();
    expect(sync).toHaveBeenCalledTimes(2);
  });

  it("reports no session when nothing could be carried over", async () => {
    const keeper = createSignedInSessionKeeper({
      session,
      sync: vi.fn().mockResolvedValue({ applied: 0, skipped: 0, source: null }),
    });
    expect(await keeper.ensureFresh()).toBe(false);
  });

  it("runs a single sync when two tabs open at once", async () => {
    let release: (value: { applied: number; skipped: number; source: null }) => void =
      () => {};
    const sync = vi.fn().mockImplementation(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    const keeper = createSignedInSessionKeeper({ session, sync });
    const first = keeper.ensureFresh();
    const second = keeper.ensureFresh();
    release({ applied: 1, skipped: 0, source: null });
    expect(await first).toBe(true);
    expect(await second).toBe(true);
    expect(sync).toHaveBeenCalledTimes(1);
  });
});

const BROWSER_VIEW_SOURCE_PATH = join(
  __dirname,
  "..",
  "src",
  "desktop-browser-view.ts",
);

describe("in-app browser tabs", () => {
  it("waits for the sign-in top-up before loading a service page", async () => {
    // The regression this guards: the tab used to load straight away, so a
    // Google Doc rendered its login form and the cookies arrived too late.
    const source = readFileSync(
      BROWSER_VIEW_SOURCE_PATH,
      "utf8",
    );
    const loader = source.slice(source.indexOf("function loadIfNeeded"));
    const body = loader.slice(0, loader.indexOf("\n  }\n"));
    expect(body).toContain("signedInServiceHostFor(url)");
    expect(body).toContain("ensureFresh()");
    const guardIndex = body.indexOf("signedInServiceHostFor(url)");
    const firstLoadIndex = body.indexOf("loadURL(url)");
    expect(guardIndex).toBeLessThan(firstLoadIndex);
  });

  it("strips the embedded-shell markers from the browser user agent", () => {
    const source = readFileSync(
      BROWSER_VIEW_SOURCE_PATH,
      "utf8",
    );
    expect(source).toContain("setUserAgent");
    expect(source).toMatch(/replace\(\/\\s\*Electron/u);
  });
});

describe("Google country domains", () => {
  it("carries the session over from the country domain the user was sent to", () => {
    // Signing in from Russia leaves SID and SAPISID on google.ru while
    // google.com holds only preferences: matching one spelling would carry
    // everything except the sign-in itself.
    const rows = [
      row({ host_key: ".google.ru" }),
      row({ host_key: "accounts.google.co.uk" }),
      row({ host_key: "google.ru.phish.example" }),
    ];
    expect(selectServiceRows(rows).map((entry) => entry.host_key)).toEqual([
      ".google.ru",
      "accounts.google.co.uk",
    ]);
  });
});
