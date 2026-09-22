// @vitest-environment jsdom

import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import type { ReactNode } from "react";
import { act, cleanup, renderHook } from "@testing-library/react";
import { createStore, Provider } from "jotai";
import { MemoryRouter, useLocation } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RouteNavigationProvider } from "@/components/ui/app-route-anchor";
import { splitLayoutAtom } from "@/lib/split-layout/atoms";
import { findPaneByContent, listPanes } from "@/lib/split-layout";
import { createSinglePaneLayout } from "@/views/thread-detail/splitThreadNavigation";
import { useOpenNewThreadPane } from "./useOpenNewThreadPane";

const compact = vi.hoisted(() => ({ value: false }));

vi.mock("@bb/shared-ui/hooks/use-compact-viewport", () => ({
  useIsCompactViewport: () => compact.value,
}));

afterEach(() => {
  cleanup();
  compact.value = false;
});

const srcRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

const ALLOWED_COMPOSE_ROUTE_FILES = [
  "hooks/useOpenNewThreadPane.ts",
  "lib/route-paths.ts",
  "components/sidebar/usePaneContentSplitDrag.ts",
  "views/thread-detail/splitThreadNavigation.ts",
  "views/RootComposeView.tsx",
  "components/layout/AppLayout.tsx",
  "components/plugin/useSetPluginEnabled.ts",
  "components/project/ProjectActionsProvider.tsx",
  "components/thread/ThreadActionsProvider.tsx",
  "components/tools/PluginCapabilities.tsx",
  "hooks/cache-owners/resource-route-owner.ts",
  "hooks/useAppSettingsRouteMemory.ts",
  "lib/plugin-sidebar-hooks.ts",
  "views/SplitWorkspaceRoute.tsx",
];

function listSourceFiles(directory: string): string[] {
  return readdirSync(directory).flatMap((entry) => {
    const entryPath = join(directory, entry);
    if (statSync(entryPath).isDirectory()) return listSourceFiles(entryPath);
    if (!/\.tsx?$/.test(entry) || /\.(test|stories)\.tsx?$/.test(entry)) {
      return [];
    }
    return [entryPath];
  });
}

function setup(initialPath: string) {
  const store = createStore();
  store.set(
    splitLayoutAtom,
    createSinglePaneLayout({ projectId: "proj_a", threadId: "thr_watched" }),
  );
  const wrapper = ({ children }: { children: ReactNode }) => (
    <Provider store={store}>
      <MemoryRouter initialEntries={[initialPath]}>
        <RouteNavigationProvider>{children}</RouteNavigationProvider>
      </MemoryRouter>
    </Provider>
  );
  const view = renderHook(
    () => ({ open: useOpenNewThreadPane(), location: useLocation() }),
    { wrapper },
  );
  return { store, view };
}

describe("useOpenNewThreadPane", () => {
  it("opens the composer beside the focused pane instead of over it", () => {
    const { store, view } = setup("/projects/proj_a/threads/thr_watched");

    act(() => {
      view.result.current.open({
        projectId: "proj_b",
        state: { sectionId: "sec_1" },
      });
    });

    const layout = store.get(splitLayoutAtom);
    expect(layout).not.toBeNull();
    const panes = listPanes(layout!.root);
    expect(panes).toHaveLength(2);
    expect(panes[0]?.content).toEqual({
      kind: "thread",
      projectId: "proj_a",
      threadId: "thr_watched",
    });
    expect(layout!.focusedPaneId).toBe(
      findPaneByContent(layout!.root, { kind: "new-thread" })?.paneId,
    );
    expect(view.result.current.location.pathname).toBe("/");
    expect(view.result.current.location.state).toEqual({
      focusPrompt: true,
      sectionId: "sec_1",
    });
  });

  it("focuses the existing composer pane instead of opening a second one", () => {
    const { store, view } = setup("/projects/proj_a/threads/thr_watched");

    act(() => view.result.current.open());
    act(() => view.result.current.open());

    expect(listPanes(store.get(splitLayoutAtom)!.root)).toHaveLength(2);
  });

  it("keeps the single-page behavior on compact viewports", () => {
    compact.value = true;
    const { store, view } = setup("/projects/proj_a/threads/thr_watched");

    act(() => view.result.current.open());

    expect(listPanes(store.get(splitLayoutAtom)!.root)).toHaveLength(1);
    expect(view.result.current.location.pathname).toBe("/");
  });
});

describe("new thread entry points", () => {
  it("routes every thread creation through the pane-opening hook", () => {
    const offenders = listSourceFiles(srcRoot)
      .filter((filePath) =>
        /get(?:Root|Project|LegacyProject)ComposeRoutePath/.test(
          readFileSync(filePath, "utf8"),
        ),
      )
      .map((filePath) => relative(srcRoot, filePath))
      .filter((filePath) => !ALLOWED_COMPOSE_ROUTE_FILES.includes(filePath));

    expect(offenders).toEqual([]);
  });
});
