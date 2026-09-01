import { readdirSync, readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, relative } from "node:path";
import { describe, expect, it } from "vitest";

const repoRoot = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "..",
  "..",
);

// Prose is typed in both trees: the app owns most screens, shared-ui owns the
// question form the agent puts in front of a person.
const SOURCE_ROOTS = ["apps/app/src", "packages/shared-ui/src"];

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

// Fields that take configuration rather than prose, plus the styling primitive
// that only forwards whatever key handler its caller passes. Markers would be
// noise there, so they stay out on purpose.
const EXCLUDED_FIELDS = [
  "apps/app/src/components/plugin/PluginSettings.tsx",
  "packages/shared-ui/src/components/ui/textarea.tsx",
];

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
  return SOURCE_ROOTS.flatMap((sourceRoot) =>
    listSourceFiles(join(repoRoot, sourceRoot)),
  )
    .map((filePath) => ({
      path: relative(repoRoot, filePath),
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
      .filter(({ path }) => !EXCLUDED_FIELDS.includes(path))
      .filter(
        ({ source }) =>
          !CONTINUATION_MODULES.some((module) => source.includes(module)),
      )
      .map(({ path }) => path);

    expect(offenders).toEqual([]);
  });

  it("keeps the excluded fields honest: they must still exist", () => {
    const known = surfacesThatAcceptTypedText().map(({ path }) => path);
    for (const excludedField of EXCLUDED_FIELDS) {
      expect(known).toContain(excludedField);
    }
  });
});
