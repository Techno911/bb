/**
 * Human-readable label for a provider model id.
 *
 * Model ids arrive as identifiers ("claude-fable-5-1", "gpt-5.6-sol",
 * "claude-opus-5[1m]"). Sidebar rows and banners need a short name a person
 * recognises, without loading the provider catalog for every row.
 */
export function modelLabel(model: string): string {
  const bare = model.replace(/\[[12]m\]$/i, "");
  const parts = bare
    .replace(/^(?:anthropic[-/])?claude-/i, "")
    .split("-")
    .filter(Boolean);
  const versionStart = parts.findIndex((part) => /^\d+(?:\.\d+)?$/.test(part));
  const nameParts = versionStart === -1 ? parts : parts.slice(0, versionStart);
  const versionParts = versionStart === -1 ? [] : parts.slice(versionStart);
  const name = nameParts
    .map((part) =>
      /^[a-z]{2,4}$/i.test(part) && part.toLowerCase() === "gpt"
        ? part.toUpperCase()
        : part.charAt(0).toUpperCase() + part.slice(1),
    )
    .join(" ");
  const [major, minor, ...qualifiers] = versionParts;
  const version = major
    ? [
        minor !== undefined && /^\d+$/.test(minor) && !major.includes(".")
          ? `${major}.${minor}`
          : major,
        ...(minor !== undefined && (!/^\d+$/.test(minor) || major.includes("."))
          ? [minor]
          : []),
        ...qualifiers,
      ]
        .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
        .join(" ")
    : "";
  return [name, version].filter(Boolean).join(" ") || model;
}

const PROVIDER_LABELS: Record<string, string> = {
  "claude-code": "Claude",
  codex: "Codex",
  pi: "Pi",
  "acp-cursor": "Cursor",
};

/** Short provider name for a row label; unknown ids are shown as-is. */
export function providerLabel(providerId: string): string {
  return PROVIDER_LABELS[providerId] ?? providerId;
}

/**
 * What a sidebar row says about the model a thread runs on: the pinned model
 * when there is one, otherwise the provider.
 */
export function threadModelRowLabel(args: {
  model: string | null | undefined;
  providerId: string;
}): string {
  return args.model ? modelLabel(args.model) : providerLabel(args.providerId);
}
