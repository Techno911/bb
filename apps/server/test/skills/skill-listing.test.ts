import type { DiscoveredSkill, SkillRootKind } from "@bb/host-daemon-contract";
import { createHash } from "node:crypto";
import type { SkillProvider } from "@bb/server-contract";
import { describe, expect, it } from "vitest";
import type { SkillSummary } from "@bb/server-contract";
import {
  assembleSkillList,
  dedupSkillSummariesByDigest,
  mapSkillScope,
} from "../../src/services/skills/skill-listing.js";

describe("mapSkillScope", () => {
  const cases: Array<{
    provider: SkillProvider;
    rootKind: SkillRootKind;
    scope: string;
    listedProvider: SkillProvider | null;
    manageable: boolean;
    filePath?: string;
  }> = [
    {
      provider: "claude-code",
      rootKind: "bb-project",
      scope: "bb-project",
      listedProvider: null,
      manageable: true,
    },
    {
      provider: "codex",
      rootKind: "bb-project",
      scope: "bb-project",
      listedProvider: null,
      manageable: true,
    },
    {
      provider: "claude-code",
      rootKind: "bb-data-dir",
      scope: "bb-user",
      listedProvider: null,
      manageable: true,
    },
    {
      provider: "claude-code",
      rootKind: "bb-builtin",
      scope: "bb-builtin",
      listedProvider: null,
      manageable: false,
    },
    {
      provider: "claude-code",
      rootKind: "provider-project",
      scope: "provider-project",
      listedProvider: "claude-code",
      manageable: true,
    },
    {
      provider: "claude-code",
      rootKind: "provider-user",
      scope: "provider-user",
      listedProvider: "claude-code",
      manageable: true,
    },
    {
      provider: "codex",
      rootKind: "provider-project",
      scope: "provider-project",
      listedProvider: "codex",
      manageable: true,
    },
    {
      provider: "codex",
      rootKind: "provider-user",
      scope: "provider-user",
      listedProvider: "codex",
      manageable: true,
    },
    {
      provider: "acp-cursor",
      rootKind: "provider-project",
      scope: "provider-project",
      listedProvider: "acp-cursor",
      manageable: true,
    },
    {
      provider: "acp-cursor",
      rootKind: "provider-user",
      scope: "provider-user",
      listedProvider: "acp-cursor",
      manageable: true,
    },
    {
      provider: "claude-code",
      rootKind: "plugin",
      scope: "plugin",
      listedProvider: "claude-code",
      manageable: false,
    },
    {
      provider: "codex",
      rootKind: "plugin",
      scope: "plugin",
      listedProvider: "codex",
      manageable: false,
    },
  ];

  for (const testCase of cases) {
    it(`maps (${testCase.provider}, ${testCase.rootKind}) → ${testCase.scope}`, () => {
      expect(
        mapSkillScope(
          testCase.provider,
          testCase.rootKind,
          testCase.filePath ?? "/home/user/skills/review/SKILL.md",
        ),
      ).toEqual({
        scope: testCase.scope,
        provider: testCase.listedProvider,
        manageable: testCase.manageable,
      });
    });
  }

  it("keeps bundled Codex system skills protected", () => {
    expect(
      mapSkillScope(
        "codex",
        "provider-user",
        "/home/user/.codex/skills/.system/imagegen/SKILL.md",
      ),
    ).toEqual({ scope: "provider-user", provider: "codex", manageable: false });
  });
});

describe("assembleSkillList", () => {
  function discovered(
    name: string,
    rootKind: SkillRootKind,
    filePath: string,
  ): DiscoveredSkill {
    return {
      id: `skill_${createHash("sha256").update(filePath).digest("hex")}`,
      name,
      description: null,
      rootKind,
      filePath,
      linked: false,
    };
  }

  it("de-dupes a bb skill discovered under both providers", () => {
    const bb = discovered(
      "shared",
      "bb-data-dir",
      "/data/skills/shared/SKILL.md",
    );
    const result = assembleSkillList([
      { provider: "claude-code", skills: [bb] },
      { provider: "codex", skills: [bb] },
    ]);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      name: "shared",
      provider: null,
      scope: "bb-user",
    });
  });

  it("keeps provider-specific skills distinct and sorts by scope then name", () => {
    const result = assembleSkillList([
      {
        provider: "claude-code",
        skills: [
          discovered(
            "zed",
            "provider-user",
            "/home/.claude/skills/zed/SKILL.md",
          ),
          discovered("alpha", "bb-project", "/cwd/.bb/skills/alpha/SKILL.md"),
        ],
      },
      {
        provider: "codex",
        skills: [
          discovered(
            "zed",
            "provider-user",
            "/home/.codex/skills/zed/SKILL.md",
          ),
        ],
      },
    ]);
    expect(result.map((skill) => [skill.scope, skill.name])).toEqual([
      ["bb-project", "alpha"],
      ["provider-user", "zed"],
      ["provider-user", "zed"],
    ]);
  });

  it("protects a Cursor skill discovered through a symlinked root", () => {
    const cursor = {
      ...discovered(
        "impeccable",
        "provider-project",
        "/cwd/.cursor/skills/impeccable/SKILL.md",
      ),
      linked: true,
    };

    expect(
      assembleSkillList([{ provider: "acp-cursor", skills: [cursor] }]),
    ).toContainEqual(
      expect.objectContaining({
        name: "impeccable",
        scope: "provider-project",
        provider: "acp-cursor",
        manageable: false,
      }),
    );
  });

  it("keeps linked provider user skills visible but not manageable", () => {
    const linked = {
      ...discovered(
        "shared-link",
        "provider-user",
        "/home/.codex/skills/shared-link/SKILL.md",
      ),
      linked: true,
    };

    expect(
      assembleSkillList([{ provider: "codex", skills: [linked] }])[0],
    ).toMatchObject({
      name: "shared-link",
      scope: "provider-user",
      manageable: false,
    });
  });
});

describe("dedupSkillSummariesByDigest", () => {
  function summary(
    name: string,
    scope: SkillSummary["scope"],
    filePath: string,
  ): SkillSummary {
    return {
      id: `skill_${createHash("sha256").update(filePath).digest("hex")}`,
      name,
      description: null,
      provider: null,
      scope,
      pluginId: null,
      filePath,
      manageable: false,
      registrySkillId: null,
    };
  }

  it("collapses the same SKILL.md content registered under two scopes, keeping the wider one", () => {
    const bbShared = summary(
      "chip-client-fixture",
      "shared-user",
      "/Users/techno/.bb/shared-provider-skills/chip-client-fixture/SKILL.md",
    );
    const providerCopy = summary(
      "chip-client-fixture",
      "provider-user",
      "/Users/techno/.claude/skills/chip-client-fixture/SKILL.md",
    );
    const digest = "same-content-digest";
    const result = dedupSkillSummariesByDigest(
      [providerCopy, bbShared],
      new Map([
        [bbShared.filePath, digest],
        [providerCopy.filePath, digest],
      ]),
    );
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      name: "chip-client-fixture",
      scope: "shared-user",
      filePath: bbShared.filePath,
    });
  });

  it("does not merge two different skills that only happen to share a name", () => {
    const first = summary(
      "editorial-composition",
      "shared-user",
      "/a/editorial-composition/SKILL.md",
    );
    const second = summary(
      "editorial-composition",
      "provider-user",
      "/b/editorial-composition/SKILL.md",
    );
    const result = dedupSkillSummariesByDigest(
      [first, second],
      new Map([
        [first.filePath, "digest-a"],
        [second.filePath, "digest-b"],
      ]),
    );
    expect(result).toHaveLength(2);
  });

  it("passes through skills whose digest could not be computed", () => {
    const skill = summary("undigested", "provider-user", "/x/SKILL.md");
    expect(dedupSkillSummariesByDigest([skill], new Map())).toEqual([skill]);
  });

  it("lock: no two entries in the result ever share a content digest", () => {
    const skills = [
      summary("x", "shared-project", "/p/SKILL.md"),
      summary("x", "provider-project", "/q/SKILL.md"),
      summary("x", "provider-user", "/r/SKILL.md"),
    ];
    const digestByFilePath = new Map([
      ["/p/SKILL.md", "dup"],
      ["/q/SKILL.md", "dup"],
      ["/r/SKILL.md", "dup"],
    ]);
    const result = dedupSkillSummariesByDigest(skills, digestByFilePath);
    const digests = result.map((skill) => digestByFilePath.get(skill.filePath));
    expect(new Set(digests).size).toBe(digests.length);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ scope: "shared-project" });
  });
});
