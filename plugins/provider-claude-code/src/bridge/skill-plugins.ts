import { createHash } from "node:crypto";
import {
  type Dirent,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  readlinkSync,
  renameSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export interface ClaudeSkillPluginRoot {
  id: string;
  path: string;
}

interface ClaudePluginManifest {
  $schema: string;
  name: string;
  version: string;
  description: string;
  author: { name: string };
  skills: string;
}

const MANIFEST_SCHEMA = "https://anthropic.com/claude-code/plugin.schema.json";

function pluginDirectoryName(root: ClaudeSkillPluginRoot): string {
  return createHash("sha256")
    .update(`${root.id}\0${root.path}`)
    .digest("hex")
    .slice(0, 16);
}

export const CLAUDE_SKILL_PLUGIN_NAME = "bb-global-skills";

function pluginNameFor(
  root: ClaudeSkillPluginRoot,
  takenBy: ReadonlyMap<string, string>,
): string {
  const directory = pluginDirectoryName(root);
  const owner = takenBy.get(CLAUDE_SKILL_PLUGIN_NAME);
  if (owner === undefined || owner === directory) {
    return CLAUDE_SKILL_PLUGIN_NAME;
  }
  return `${CLAUDE_SKILL_PLUGIN_NAME}-${directory.slice(0, 8)}`;
}

export function ensureClaudeSkillPlugin(args: {
  pluginsRoot: string;
  root: ClaudeSkillPluginRoot;
  takenNames?: Map<string, string>;
}): string {
  const directory = pluginDirectoryName(args.root);
  const pluginPath = join(args.pluginsRoot, directory);
  const takenNames = args.takenNames ?? new Map<string, string>();
  const name = pluginNameFor(args.root, takenNames);
  takenNames.set(name, directory);
  mkdirSync(join(pluginPath, ".claude-plugin"), { recursive: true });
  const manifest: ClaudePluginManifest = {
    $schema: MANIFEST_SCHEMA,
    name,
    version: "0.1.0",
    description: `Skills injected by bb (${args.root.id}).`,
    author: { name: "bb" },
    skills: "./skills",
  };
  writeFileSync(
    join(pluginPath, ".claude-plugin", "plugin.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
    "utf8",
  );
  const skillsLink = join(pluginPath, "skills");
  let current: string | null = null;
  try {
    current = lstatSync(skillsLink).isSymbolicLink()
      ? readlinkSync(skillsLink)
      : "";
  } catch {
    current = null;
  }
  if (current !== args.root.path) {
    rmSync(skillsLink, { recursive: true, force: true });
    symlinkSync(args.root.path, skillsLink, "dir");
  }
  return pluginPath;
}

export function createClaudeSkillPluginsRoot(baseDir = tmpdir()): string {
  mkdirSync(baseDir, { recursive: true });
  return mkdtempSync(join(baseDir, "bb-claude-skill-plugins-"));
}

export interface NativeSkillLookupDirs {
  homeDir: string;
  cwd: string;
}

function skillNamesOf(skillDirectory: string, entryName: string): string[] {
  const names = [entryName.toLowerCase()];
  let frontMatter: string;
  try {
    frontMatter = readFileSync(join(skillDirectory, "SKILL.md"), "utf8").slice(
      0,
      4096,
    );
  } catch {
    return [];
  }
  const declared = /^\s*name\s*:\s*(.+?)\s*$/mu.exec(frontMatter);
  if (declared?.[1] !== undefined) {
    const value = declared[1].replace(/^["']|["']$/gu, "").toLowerCase();
    if (value.length > 0 && !names.includes(value)) {
      names.push(value);
    }
  }
  return names;
}

function listSkillDirectories(
  root: string,
): { entryName: string; names: string[] }[] {
  let entries: Dirent[];
  try {
    entries = readdirSync(root, { withFileTypes: true });
  } catch {
    return [];
  }
  const skills: { entryName: string; names: string[] }[] = [];
  for (const entry of entries) {
    if (entry.name.startsWith(".")) {
      continue;
    }
    const path = join(root, entry.name);
    let isDirectory = entry.isDirectory();
    if (!isDirectory && entry.isSymbolicLink()) {
      try {
        isDirectory = statSync(path).isDirectory();
      } catch {
        isDirectory = false;
      }
    }
    if (!isDirectory) {
      continue;
    }
    const names = skillNamesOf(path, entry.name);
    if (names.length > 0) {
      skills.push({ entryName: entry.name, names });
    }
  }
  return skills;
}

export function collectNativeClaudeSkillNames(
  dirs: NativeSkillLookupDirs,
): Set<string> {
  const names = new Set<string>();
  for (const base of [dirs.homeDir, dirs.cwd]) {
    if (base.length === 0) {
      continue;
    }
    for (const skill of listSkillDirectories(join(base, ".claude", "skills"))) {
      for (const name of skill.names) {
        names.add(name);
      }
    }
  }
  return names;
}

export function resolveDedupedSkillRootPath(args: {
  stageRoot: string;
  rootPath: string;
  nativeSkillNames: ReadonlySet<string>;
}): string {
  const skills = listSkillDirectories(args.rootPath);
  if (skills.length === 0 || args.nativeSkillNames.size === 0) {
    return args.rootPath;
  }
  const kept = skills
    .filter(
      (skill) => !skill.names.some((name) => args.nativeSkillNames.has(name)),
    )
    .map((skill) => skill.entryName)
    .sort();
  if (kept.length === skills.length) {
    return args.rootPath;
  }
  const digest = createHash("sha256")
    .update(`${args.rootPath}\0${kept.join("\0")}`)
    .digest("hex")
    .slice(0, 16);
  const stagedPath = join(args.stageRoot, digest);
  if (existsSync(stagedPath)) {
    return stagedPath;
  }
  const pendingPath = `${stagedPath}.pending-${process.pid}`;
  rmSync(pendingPath, { recursive: true, force: true });
  mkdirSync(pendingPath, { recursive: true });
  for (const entryName of kept) {
    symlinkSync(
      join(args.rootPath, entryName),
      join(pendingPath, entryName),
      "dir",
    );
  }
  try {
    renameSync(pendingPath, stagedPath);
  } catch (error) {
    rmSync(pendingPath, { recursive: true, force: true });
    if (!existsSync(stagedPath)) {
      throw error;
    }
  }
  return stagedPath;
}
