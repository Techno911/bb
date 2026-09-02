import { readdirSync, readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, relative } from "node:path";
import { describe, expect, it } from "vitest";

const srcRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

/**
 * Every place that opens a browser tab has to let signed-in services through
 * to the user's own browser.
 *
 * The in-app browser runs on its own Electron session, so a Google Docs link
 * opened there renders signed out and cannot be edited. Routing lives in
 * `requiresSignedInBrowser`; without this test the next surface that opens a
 * tab would quietly send those links back into the in-app browser.
 */
const OPEN_BROWSER_TAB = /openTab\(\s*\{\s*kind:\s*"browser"/u;
const ROUTING_CALL = "requiresSignedInBrowser";

function listSourceFiles(directory: string): string[] {
  return readdirSync(directory).flatMap((entry) => {
    const entryPath = join(directory, entry);
    if (statSync(entryPath).isDirectory()) {
      return listSourceFiles(entryPath);
    }
    if (!/\.tsx?$/u.test(entry) || /\.(test|stories)\.tsx?$/u.test(entry)) {
      return [];
    }
    return [entryPath];
  });
}

describe("browser tab surfaces", () => {
  it("route signed-in services to the user's browser", () => {
    const offenders = listSourceFiles(srcRoot)
      .filter((file) => {
        const source = readFileSync(file, "utf8");
        return OPEN_BROWSER_TAB.test(source) && !source.includes(ROUTING_CALL);
      })
      .map((file) => relative(srcRoot, file));

    expect(offenders).toEqual([]);
  });
});
