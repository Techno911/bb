import { readdirSync, readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, relative } from "node:path";
import { describe, expect, it } from "vitest";

const srcRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

const NEW_THREAD_PANE_HOOK = "hooks/useOpenNewThreadPane.ts";

const SPLIT_ROUTING_FILES = [
  "components/sidebar/usePaneContentSplitDrag.ts",
  "views/thread-detail/splitThreadNavigation.ts",
];

const NON_CREATING_NAVIGATION_FILES = [
  "components/layout/AppLayout.tsx",
  "components/project/ProjectActionsProvider.tsx",
  "components/thread/ThreadActionsProvider.tsx",
  "components/tools/PluginCapabilities.tsx",
  "hooks/cache-owners/resource-route-owner.ts",
  "hooks/useAppSettingsRouteMemory.ts",
  "views/RootComposeView.tsx",
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

describe("new thread entry points", () => {
  it("routes every thread creation through the pane-opening hook", () => {
    const offenders = listSourceFiles(srcRoot)
      .filter((filePath) =>
        readFileSync(filePath, "utf8").includes("getRootComposeRoutePath"),
      )
      .map((filePath) => relative(srcRoot, filePath))
      .filter(
        (filePath) =>
          filePath !== NEW_THREAD_PANE_HOOK &&
          filePath !== "lib/route-paths.ts" &&
          !SPLIT_ROUTING_FILES.includes(filePath) &&
          !NON_CREATING_NAVIGATION_FILES.includes(filePath),
      );

    expect(offenders).toEqual([]);
  });

  it("opens the composer beside the focused pane instead of replacing it", () => {
    const source = readFileSync(join(srcRoot, NEW_THREAD_PANE_HOOK), "utf8");

    expect(source).toContain("openPaneContentInSplit");
    expect(source).toContain('content: NEW_THREAD_PANE_CONTENT');
    expect(source).toContain("enabled: !isCompactViewport");
  });
});
