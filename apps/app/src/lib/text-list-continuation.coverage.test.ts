import { readdirSync, readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, relative } from "node:path";
import { describe, expect, it } from "vitest";

const srcRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

/**
 * Every field where a person writes prose continues plain-text lists.
 *
 * Without this the behaviour would live in whichever field happened to be
 * fixed first, and the next input added to the app would quietly lack it.
 */
const CONTINUATION_MODULES = [
  "text-list-continuation",
  // The prompt editor reaches the same logic through its tiptap adapter.
  "prompt-editor-text-list",
];

// Fields that take configuration rather than prose. Markers would be noise
// there, so they stay out on purpose.
const SETTINGS_FIELDS = ["components/plugin/PluginSettings.tsx"];

function listSourceFiles(directory: string): string[] {
  return readdirSync(directory).flatMap((entry) => {
    const entryPath = join(directory, entry);
    if (statSync(entryPath).isDirectory()) {
      return listSourceFiles(entryPath);
    }
    if (!/\.tsx?$/.test(entry) || /\.(test|stories)\.tsx?$/.test(entry)) {
      return [];
    }
    return [entryPath];
  });
}

function surfacesThatAcceptTypedText(): { path: string; source: string }[] {
  return listSourceFiles(srcRoot)
    .map((filePath) => ({
      path: relative(srcRoot, filePath),
      source: readFileSync(filePath, "utf8"),
    }))
    .filter(
      ({ source }) =>
        source.includes("<textarea") ||
        source.includes("<Textarea") ||
        source.includes("useEditor("),
    );
}

describe("plain-text list continuation", () => {
  it("reaches every field where a person types prose", () => {
    const offenders = surfacesThatAcceptTypedText()
      .filter(({ path }) => !SETTINGS_FIELDS.includes(path))
      .filter(
        ({ source }) =>
          !CONTINUATION_MODULES.some((module) => source.includes(module)),
      )
      .map(({ path }) => path);

    expect(offenders).toEqual([]);
  });

  it("keeps the excluded fields honest: they must still exist", () => {
    const known = surfacesThatAcceptTypedText().map(({ path }) => path);
    for (const settingsField of SETTINGS_FIELDS) {
      expect(known).toContain(settingsField);
    }
  });
});
