import type { ThreadListEntry } from "@bb/domain";
import { describe, expect, it } from "vitest";
import {
  buildProjectThreadGroups,
  buildSectionThreadList,
  CHRONOLOGICAL_CONTAINER_ID,
} from "@bb/client-core";
import {
  collectProjectThreadDndLookup,
  collectSectionThreadDndLookup,
  PINNED_THREAD_PARENT_KEY,
  resolveSectionThreadDropDecision,
  resolveSectionThreadDropTarget,
  resolveSectionThreadSectionOverId,
  resolveProjectedSectionThreadDropTarget,
} from "./useSectionThreadDnd";

function createThread(overrides: Partial<ThreadListEntry>): ThreadListEntry {
  return {
    id: "thread",
    projectId: "project",
    environmentId: null,
    providerId: "codex",
    title: "Thread",
    titleFallback: "Thread",
    sectionId: null,
    status: "idle",
    parentThreadId: null,
    sourceThreadId: null,
    originKind: null,
    originPluginId: null,
    visibility: "visible",
    archivedAt: null,
    pinnedAt: null,
    pinSortKey: null,
    deletedAt: null,
    lastReadAt: 0,
    latestAttentionAt: 2,
    createdAt: 1,
    updatedAt: 2,
    activity: {
      activeWorkflowCount: 0,
      activeBackgroundAgentCount: 0,
      activeBackgroundCommandCount: 0,
      activePlanModeCount: 0,
      activeGoalCount: 0,
    },
    hasPendingInteraction: false,
    environmentHostId: null,
    environmentName: null,
    environmentBranchName: null,
    environmentWorkspaceDisplayKind: "other",
    runtime: {
      displayStatus: "idle",
      hostReconnectGraceExpiresAt: null,
    },
    ...overrides,
  };
}

function createLookup() {
  return collectSectionThreadDndLookup(
    buildSectionThreadList(
      [
        createThread({ id: "in-a", sectionId: "a" }),
        createThread({ id: "loose", createdAt: 2 }),
      ],
      undefined,
      [
        { id: "a", name: "Section A" },
        { id: "b", name: "Empty Section B" },
      ],
    ),
    CHRONOLOGICAL_CONTAINER_ID,
  );
}

function createLookupWithPinnedThread(
  overrides: Partial<ThreadListEntry> = {},
) {
  return collectSectionThreadDndLookup(
    buildSectionThreadList(
      [
        createThread({ id: "in-a", sectionId: "a" }),
        createThread({ id: "loose", createdAt: 2 }),
      ],
      undefined,
      [
        { id: "a", name: "Section A" },
        { id: "b", name: "Empty Section B" },
      ],
    ),
    CHRONOLOGICAL_CONTAINER_ID,
    [
      createThread({
        id: "pinned-1",
        sectionId: "a",
        pinnedAt: 10,
        ...overrides,
      }),
      createThread({ id: "pinned-2", pinnedAt: 9 }),
    ],
  );
}

describe("section thread drop targets", () => {
  it("moves a loose thread onto an empty section header", () => {
    const lookup = createLookup();
    const sectionBKey = lookup.sectionParentKeyBySectionId.get("section:b");

    expect(sectionBKey).toBeDefined();
    expect(
      resolveSectionThreadDropTarget(lookup, "loose", sectionBKey ?? null),
    ).toEqual({
      activeId: "loose",
      fromParentKey: CHRONOLOGICAL_CONTAINER_ID,
      toParentKey: sectionBKey,
    });
  });

  it("accepts an empty section section itself as a target", () => {
    const lookup = createLookup();
    const sectionBKey = lookup.sectionParentKeyBySectionId.get("section:b");

    expect(
      resolveSectionThreadDropTarget(lookup, "loose", "section:b"),
    ).toEqual({
      activeId: "loose",
      fromParentKey: CHRONOLOGICAL_CONTAINER_ID,
      toParentKey: sectionBKey,
    });
  });

  it("moves a section thread back to the loose Threads section", () => {
    const lookup = createLookup();
    const sectionAKey = lookup.sectionParentKeyBySectionId.get("section:a");

    expect(resolveSectionThreadDropTarget(lookup, "in-a", "threads")).toEqual({
      activeId: "in-a",
      fromParentKey: sectionAKey,
      toParentKey: CHRONOLOGICAL_CONTAINER_ID,
    });
  });

  it("preserves a projected destination through self-collision", () => {
    const lookup = createLookup();
    const sectionBKey = lookup.sectionParentKeyBySectionId.get("section:b");

    expect(sectionBKey).toBeDefined();
    expect(
      resolveProjectedSectionThreadDropTarget(
        lookup,
        "loose",
        sectionBKey ?? null,
      ),
    ).toEqual({
      activeId: "loose",
      fromParentKey: CHRONOLOGICAL_CONTAINER_ID,
      toParentKey: sectionBKey,
    });
  });

  it("rejects same-parent and non-thread moves", () => {
    const lookup = createLookup();
    const sectionAKey = lookup.sectionParentKeyBySectionId.get("section:a");

    expect(
      resolveSectionThreadDropTarget(lookup, "in-a", sectionAKey ?? null),
    ).toBeNull();
    expect(
      resolveSectionThreadDropTarget(
        lookup,
        sectionAKey ?? "section:a",
        "threads",
      ),
    ).toBeNull();
  });
});

describe("section thread section drop targets", () => {
  it("resolves a section section", () => {
    const lookup = createLookup();
    const sectionAKey = lookup.sectionParentKeyBySectionId.get("section:a");

    expect(sectionAKey).toBeDefined();
    expect(
      resolveSectionThreadSectionOverId(lookup, sectionAKey ?? "section:a"),
    ).toBe("section:a");
  });

  it("resolves a thread inside a section", () => {
    expect(resolveSectionThreadSectionOverId(createLookup(), "in-a")).toBe(
      "section:a",
    );
  });

  it("resolves the chronological container to the Threads section", () => {
    expect(
      resolveSectionThreadSectionOverId(
        createLookup(),
        CHRONOLOGICAL_CONTAINER_ID,
      ),
    ).toBe("threads");
  });

  it("preserves another top-level section id", () => {
    expect(resolveSectionThreadSectionOverId(createLookup(), "pinned")).toBe(
      "pinned",
    );
  });
});

describe("section thread pin drop decisions", () => {
  it("pins an unpinned thread dropped on the Pinned container", () => {
    expect(
      resolveSectionThreadDropDecision(
        createLookupWithPinnedThread(),
        "section",
        "loose",
        "pinned",
      ),
    ).toEqual({ kind: "pin", activeId: "loose" });
  });

  it("preserves a projected Pinned destination through self-collision", () => {
    expect(
      resolveSectionThreadDropDecision(
        createLookupWithPinnedThread(),
        "section",
        "loose",
        "loose",
        PINNED_THREAD_PARENT_KEY,
      ),
    ).toEqual({ kind: "pin", activeId: "loose" });
  });

  it("unpins a pinned thread into Threads and clears its section", () => {
    expect(
      resolveSectionThreadDropDecision(
        createLookupWithPinnedThread(),
        "section",
        "pinned-1",
        "threads",
      ),
    ).toEqual({
      kind: "unpin",
      activeId: "pinned-1",
      targetId: null,
      move: true,
    });
  });

  it("unpins a pinned thread into a section without a redundant move", () => {
    expect(
      resolveSectionThreadDropDecision(
        createLookupWithPinnedThread(),
        "section",
        "pinned-1",
        "section:a",
      ),
    ).toEqual({
      kind: "unpin",
      activeId: "pinned-1",
      targetId: "a",
      move: false,
    });
  });

  it("keeps reorder-within-Pinned as a pinned reorder", () => {
    expect(
      resolveSectionThreadDropDecision(
        createLookupWithPinnedThread(),
        "section",
        "pinned-1",
        "pinned-2",
      ),
    ).toEqual({
      kind: "reorder-pinned",
      activeId: "pinned-1",
      overId: "pinned-2",
    });
  });
});


function createProjectLookup() {
  return collectProjectThreadDndLookup(
    [
      {
        parentKey: "proj_a",
        sectionId: "project:proj_a",
        items: buildProjectThreadGroups([
          createThread({ id: "in-a", projectId: "proj_a" }),
        ]),
      },
      {
        parentKey: "proj_b",
        sectionId: "project:proj_b",
        items: [],
      },
    ],
    [
      createThread({ id: "pinned-1", projectId: "proj_a", pinnedAt: 10 }),
      createThread({ id: "pinned-2", projectId: "proj_b", pinnedAt: 9 }),
    ],
  );
}

describe("project thread drop decisions", () => {
  it("moves a thread dropped on another project row", () => {
    expect(
      resolveSectionThreadDropDecision(
        createProjectLookup(),
        "project",
        "in-a",
        "project:proj_b",
      ),
    ).toEqual({ kind: "move", activeId: "in-a", targetId: "proj_b" });
  });

  it("ignores a drop back on the owning project", () => {
    expect(
      resolveSectionThreadDropDecision(
        createProjectLookup(),
        "project",
        "in-a",
        "project:proj_a",
      ),
    ).toBeNull();
  });

  it("unpins and moves a pinned thread dropped on another project", () => {
    expect(
      resolveSectionThreadDropDecision(
        createProjectLookup(),
        "project",
        "pinned-1",
        "project:proj_b",
      ),
    ).toEqual({
      kind: "unpin",
      activeId: "pinned-1",
      targetId: "proj_b",
      move: true,
    });
  });

  it("unpins without a redundant move when the project is unchanged", () => {
    expect(
      resolveSectionThreadDropDecision(
        createProjectLookup(),
        "project",
        "pinned-1",
        "project:proj_a",
      ),
    ).toEqual({
      kind: "unpin",
      activeId: "pinned-1",
      targetId: "proj_a",
      move: false,
    });
  });

  it("pins a project thread dropped on the Pinned section", () => {
    expect(
      resolveSectionThreadDropDecision(
        createProjectLookup(),
        "project",
        "in-a",
        "pinned",
      ),
    ).toEqual({ kind: "pin", activeId: "in-a" });
  });
});
