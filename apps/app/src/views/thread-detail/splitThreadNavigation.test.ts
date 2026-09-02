import { describe, expect, it } from "vitest";
import {
  findPaneByContent,
  findPaneByThread,
  listPanes,
  MAX_PANES,
  splitPane,
} from "@/lib/split-layout";
import type { SplitLayout } from "@/lib/split-layout";
import {
  applyThreadOpenToLayout,
  applyThreadPaneActionToLayout,
  createSinglePaneLayout,
  focusedPaneRoute,
  reconcileLayoutForContent,
  reconcileLayoutForContentOnLoad,
} from "./splitThreadNavigation";

function twoPaneLayout(): SplitLayout {
  return splitPane(
    createSinglePaneLayout({ projectId: "p1", threadId: "thread-1" }),
    "pane-1",
    "right",
    {
      kind: "thread",
      projectId: "p1",
      threadId: "thread-2",
    },
  );
}

function cappedPaneLayout(): SplitLayout {
  let layout = twoPaneLayout();
  for (let index = 3; index <= MAX_PANES; index += 1) {
    layout = applyThreadOpenToLayout(
      layout,
      { projectId: "p1", threadId: `thread-${index}` },
      "right",
    );
  }
  return layout;
}

describe("mixed page navigation", () => {
  it("keeps New Thread as a singleton and focuses its existing pane", () => {
    const withCompose = splitPane(twoPaneLayout(), "pane-2", "bottom", {
      kind: "new-thread",
    });

    const after = reconcileLayoutForContent(withCompose, {
      kind: "new-thread",
    });

    expect(listPanes(after.root)).toHaveLength(3);
    expect(after.focusedPaneId).toBe(
      findPaneByContent(after.root, { kind: "new-thread" })?.paneId,
    );
    expect(focusedPaneRoute(after)).toBe("/");
  });

  it("opens the root composer beside a restored layout instead of over its focused pane", () => {
    const restored = twoPaneLayout();

    const after = reconcileLayoutForContentOnLoad(restored, {
      kind: "new-thread",
    });

    expect(listPanes(after.root)).toHaveLength(3);
    expect(
      listPanes(after.root).filter((pane) => pane.content.kind === "thread"),
    ).toHaveLength(2);
    expect(after.focusedPaneId).toBe(
      findPaneByContent(after.root, { kind: "new-thread" })?.paneId,
    );
    // Rightmost pane, whichever pane was focused when the layout was saved.
    const order = listPanes(after.root).map((pane) => pane.content.kind);
    expect(order).toEqual(["thread", "thread", "new-thread"]);
  });

  it("keeps the usual replace rule on load for content other than the composer", () => {
    const restored = twoPaneLayout();
    const plugin = {
      kind: "plugin-panel",
      pluginId: "notes",
      panelPath: "notes",
      subPath: "",
    } as const;

    const after = reconcileLayoutForContentOnLoad(restored, plugin);

    expect(listPanes(after.root)).toHaveLength(2);
    expect(findPaneByContent(after.root, plugin)).not.toBeNull();
  });

  it("updates a plugin pane's subpath without duplicating the panel", () => {
    const plugin = {
      kind: "plugin-panel",
      pluginId: "notes",
      panelPath: "notes",
      subPath: "inbox.md",
    } as const;
    const before = splitPane(twoPaneLayout(), "pane-1", "bottom", plugin);

    const after = reconcileLayoutForContent(before, {
      ...plugin,
      subPath: "work/today.md",
    });

    expect(listPanes(after.root)).toHaveLength(3);
    expect(findPaneByContent(after.root, plugin)?.content).toEqual({
      ...plugin,
      subPath: "work/today.md",
    });
    expect(focusedPaneRoute(after)).toBe("/plugins/notes/notes/work/today.md");
  });
});

describe("applyThreadOpenToLayout", () => {
  it("splits from the focused pane and focuses the opened thread", () => {
    const before = twoPaneLayout();
    const after = applyThreadOpenToLayout(
      before,
      { projectId: "p2", threadId: "thread-3" },
      "down",
    );

    expect(listPanes(after.root)).toHaveLength(3);
    expect(findPaneByThread(after.root, "p2", "thread-3")?.paneId).toBe(
      after.focusedPaneId,
    );
  });

  it("focuses an already-open thread instead of duplicating it", () => {
    const before = twoPaneLayout();
    const after = applyThreadOpenToLayout(
      before,
      { projectId: "p1", threadId: "thread-1" },
      "right",
    );

    expect(listPanes(after.root)).toHaveLength(2);
    expect(after.focusedPaneId).toBe("pane-1");
  });

  it("creates panes up to the cap, then replaces the focused pane for one more open", () => {
    const capped = cappedPaneLayout();
    const focusedPaneId = capped.focusedPaneId;

    expect(listPanes(capped.root)).toHaveLength(MAX_PANES);
    expect(capped.root).toMatchObject({
      type: "split",
      dir: "row",
      sizes: Array.from({ length: MAX_PANES }, () => 1 / MAX_PANES),
    });
    for (let index = 5; index <= MAX_PANES; index += 1) {
      expect(
        findPaneByThread(capped.root, "p1", `thread-${index}`),
      ).not.toBeNull();
    }

    const after = applyThreadOpenToLayout(
      capped,
      { projectId: "p2", threadId: "extra-thread" },
      "left",
    );

    expect(listPanes(after.root)).toHaveLength(MAX_PANES);
    expect(after.focusedPaneId).toBe(focusedPaneId);
    expect(findPaneByThread(after.root, "p2", "extra-thread")?.paneId).toBe(
      focusedPaneId,
    );
    expect(
      findPaneByThread(after.root, "p1", `thread-${MAX_PANES}`),
    ).toBeNull();
  });
});

describe("applyThreadPaneActionToLayout", () => {
  it("focuses and maximizes the targeted open thread without changing the tree", () => {
    const before = twoPaneLayout();
    const result = applyThreadPaneActionToLayout(
      before,
      null,
      { projectId: "p1", threadId: "thread-1" },
      "maximize",
    );

    expect(result.layout.root).toEqual(before.root);
    expect(result.layout.focusedPaneId).toBe("pane-1");
    expect(result.maximizedPaneId).toBe("pane-1");
    expect(result.dimInactiveSplits).toBeNull();
  });

  it("restores only the targeted maximized pane and toggles it back", () => {
    const before = twoPaneLayout();
    const restored = applyThreadPaneActionToLayout(
      before,
      "pane-2",
      { projectId: "p1", threadId: "thread-2" },
      "restore",
    );
    expect(restored).toEqual({
      layout: before,
      maximizedPaneId: null,
      dimInactiveSplits: null,
    });

    const toggled = applyThreadPaneActionToLayout(
      restored.layout,
      restored.maximizedPaneId,
      { projectId: "p1", threadId: "thread-2" },
      "toggle",
    );
    expect(toggled.maximizedPaneId).toBe("pane-2");
  });

  it.each([
    ["spotlight", true],
    ["clear-spotlight", false],
  ] as const)(
    "focuses the target for %s and returns the preference",
    (action, expected) => {
      const before = twoPaneLayout();
      const result = applyThreadPaneActionToLayout(
        before,
        null,
        { projectId: "p1", threadId: "thread-1" },
        action,
      );

      expect(result.layout.root).toEqual(before.root);
      expect(result.layout.focusedPaneId).toBe("pane-1");
      expect(result.maximizedPaneId).toBeNull();
      expect(result.dimInactiveSplits).toBe(expected);
    },
  );

  it("is a no-op when the target is not open", () => {
    const before = twoPaneLayout();
    expect(
      applyThreadPaneActionToLayout(
        before,
        "pane-2",
        { projectId: "p1", threadId: "missing" },
        "maximize",
      ),
    ).toEqual({
      layout: before,
      maximizedPaneId: "pane-2",
      dimInactiveSplits: null,
    });
  });
});
