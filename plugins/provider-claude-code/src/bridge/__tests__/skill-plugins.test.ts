import {
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  readlinkSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  CLAUDE_SKILL_PLUGIN_NAME,
  collectNativeClaudeSkillNames,
  createClaudeSkillPluginsRoot,
  ensureClaudeSkillPlugin,
  resolveDedupedSkillRootPath,
} from "../skill-plugins.js";

describe("claude skill plugins", () => {
  let baseDir: string;

  beforeEach(() => {
    baseDir = mkdtempSync(join(tmpdir(), "bb-claude-skill-plugins-test-"));
  });

  afterEach(() => {
    rmSync(baseDir, { recursive: true, force: true });
  });

  function stageSkills(name: string): string {
    const root = join(baseDir, `stage-${name}`, "skills");
    mkdirSync(join(root, "demo"), { recursive: true });
    writeFileSync(
      join(root, "demo", "SKILL.md"),
      "---\nname: demo\ndescription: demo\n---\n",
    );
    return root;
  }

  it("assembles a plugin whose skills directory links to the generic root", () => {
    const pluginsRoot = createClaudeSkillPluginsRoot(baseDir);
    const skillsPath = stageSkills("a");
    const pluginPath = ensureClaudeSkillPlugin({
      pluginsRoot,
      root: { id: "global-skills:abc123", path: skillsPath },
    });

    expect(pluginPath.startsWith(pluginsRoot)).toBe(true);
    const manifest = JSON.parse(
      readFileSync(join(pluginPath, ".claude-plugin", "plugin.json"), "utf8"),
    ) as { name: string; skills: string };
    expect(manifest.skills).toBe("./skills");
    expect(manifest.name).toBe(CLAUDE_SKILL_PLUGIN_NAME);
    expect(lstatSync(join(pluginPath, "skills")).isSymbolicLink()).toBe(true);
    expect(readlinkSync(join(pluginPath, "skills"))).toBe(skillsPath);
    expect(
      readFileSync(join(pluginPath, "skills", "demo", "SKILL.md"), "utf8"),
    ).toContain("name: demo");
  });

  it("is idempotent for a root and re-points the link when the root moves", () => {
    const pluginsRoot = createClaudeSkillPluginsRoot(baseDir);
    const first = stageSkills("a");
    const second = stageSkills("b");
    const pluginPath = ensureClaudeSkillPlugin({
      pluginsRoot,
      root: { id: "r", path: first },
    });
    expect(
      ensureClaudeSkillPlugin({ pluginsRoot, root: { id: "r", path: first } }),
    ).toBe(pluginPath);
    expect(readlinkSync(join(pluginPath, "skills"))).toBe(first);

    const movedPluginPath = ensureClaudeSkillPlugin({
      pluginsRoot,
      root: { id: "r", path: second },
    });
    expect(movedPluginPath).not.toBe(pluginPath);
    expect(readlinkSync(join(movedPluginPath, "skills"))).toBe(second);
  });

  it("keeps the stable name across catalog changes and suffixes only a colliding second root", () => {
    const pluginsRoot = createClaudeSkillPluginsRoot(baseDir);
    const first = stageSkills("a");
    const second = stageSkills("b");
    const nameOf = (pluginPath: string): string =>
      (
        JSON.parse(
          readFileSync(
            join(pluginPath, ".claude-plugin", "plugin.json"),
            "utf8",
          ),
        ) as { name: string }
      ).name;

    expect(
      nameOf(
        ensureClaudeSkillPlugin({
          pluginsRoot,
          root: { id: "global-skills:aaaa", path: first },
        }),
      ),
    ).toBe(CLAUDE_SKILL_PLUGIN_NAME);
    expect(
      nameOf(
        ensureClaudeSkillPlugin({
          pluginsRoot,
          root: { id: "global-skills:bbbb", path: second },
        }),
      ),
    ).toBe(CLAUDE_SKILL_PLUGIN_NAME);

    const takenNames = new Map<string, string>();
    const a = ensureClaudeSkillPlugin({
      pluginsRoot,
      root: { id: "global-skills:aaaa", path: first },
      takenNames,
    });
    const b = ensureClaudeSkillPlugin({
      pluginsRoot,
      root: { id: "global-skills:bbbb", path: second },
      takenNames,
    });
    expect(nameOf(a)).toBe(CLAUDE_SKILL_PLUGIN_NAME);
    expect(nameOf(b)).toMatch(/^bb-global-skills-[0-9a-f]{8}$/u);
  });
});

describe("claude skill catalog deduplication", () => {
  let baseDir: string;

  beforeEach(() => {
    baseDir = mkdtempSync(join(tmpdir(), "bb-claude-skill-dedup-test-"));
  });

  afterEach(() => {
    rmSync(baseDir, { recursive: true, force: true });
  });

  function writeSkill(root: string, directory: string, name = directory): void {
    mkdirSync(join(root, directory), { recursive: true });
    writeFileSync(
      join(root, directory, "SKILL.md"),
      `---\nname: ${name}\ndescription: ${name}\n---\n`,
    );
  }

  function stageRootDir(): string {
    const stageRoot = join(baseDir, "deduped");
    mkdirSync(stageRoot, { recursive: true });
    return stageRoot;
  }

  it("drops catalog skills Claude Code already sees in the home and project directories", () => {
    const catalog = join(baseDir, "catalog");
    writeSkill(catalog, "chip-rag");
    writeSkill(catalog, "chip-brand");
    writeSkill(catalog, "chip-ui-law");

    const homeDir = join(baseDir, "home");
    writeSkill(join(homeDir, ".claude", "skills"), "chip-rag");
    const cwd = join(baseDir, "project");
    writeSkill(join(cwd, ".claude", "skills"), "chip-brand");

    const nativeSkillNames = collectNativeClaudeSkillNames({ homeDir, cwd });
    const resolved = resolveDedupedSkillRootPath({
      stageRoot: stageRootDir(),
      rootPath: catalog,
      nativeSkillNames,
    });

    expect(resolved).not.toBe(catalog);
    expect(readdirSync(resolved).sort()).toEqual(["chip-ui-law"]);
    expect(
      readFileSync(join(resolved, "chip-ui-law", "SKILL.md"), "utf8"),
    ).toContain("name: chip-ui-law");
  });

  it("matches a native skill by its front-matter name when the directory differs", () => {
    const catalog = join(baseDir, "catalog");
    writeSkill(catalog, "chip-rag");
    writeSkill(catalog, "chip-ui-law");

    const homeDir = join(baseDir, "home");
    writeSkill(
      join(homeDir, ".claude", "skills"),
      "renamed-folder",
      "chip-rag",
    );
    const cwd = join(baseDir, "project");

    const resolved = resolveDedupedSkillRootPath({
      stageRoot: stageRootDir(),
      rootPath: catalog,
      nativeSkillNames: collectNativeClaudeSkillNames({ homeDir, cwd }),
    });

    expect(readdirSync(resolved).sort()).toEqual(["chip-ui-law"]);
  });

  it("keeps the whole catalog for a session with no natively visible skills, as providers without a file scanner get it", () => {
    const catalog = join(baseDir, "catalog");
    writeSkill(catalog, "chip-ui-law");
    const homeDir = join(baseDir, "home");
    const cwd = join(baseDir, "project");
    const stageRoot = stageRootDir();

    const resolved = resolveDedupedSkillRootPath({
      stageRoot,
      rootPath: catalog,
      nativeSkillNames: collectNativeClaudeSkillNames({ homeDir, cwd }),
    });

    expect(resolved).toBe(catalog);
    expect(readdirSync(stageRoot)).toEqual([]);
  });

  it("reuses one staging directory for the same filtered set", () => {
    const catalog = join(baseDir, "catalog");
    writeSkill(catalog, "chip-rag");
    writeSkill(catalog, "chip-ui-law");
    const homeDir = join(baseDir, "home");
    writeSkill(join(homeDir, ".claude", "skills"), "chip-rag");
    const cwd = join(baseDir, "project");
    const stageRoot = stageRootDir();
    const nativeSkillNames = collectNativeClaudeSkillNames({ homeDir, cwd });

    const first = resolveDedupedSkillRootPath({
      stageRoot,
      rootPath: catalog,
      nativeSkillNames,
    });
    const second = resolveDedupedSkillRootPath({
      stageRoot,
      rootPath: catalog,
      nativeSkillNames,
    });

    expect(second).toBe(first);
    expect(readdirSync(stageRoot)).toHaveLength(1);
  });

  it("ignores directories without SKILL.md on both sides", () => {
    const catalog = join(baseDir, "catalog");
    writeSkill(catalog, "chip-ui-law");
    mkdirSync(join(catalog, "not-a-skill"), { recursive: true });
    const homeDir = join(baseDir, "home");
    mkdirSync(join(homeDir, ".claude", "skills", "chip-ui-law"), {
      recursive: true,
    });

    const nativeSkillNames = collectNativeClaudeSkillNames({
      homeDir,
      cwd: join(baseDir, "project"),
    });

    expect(nativeSkillNames.size).toBe(0);
    expect(
      resolveDedupedSkillRootPath({
        stageRoot: stageRootDir(),
        rootPath: catalog,
        nativeSkillNames,
      }),
    ).toBe(catalog);
  });
});
