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

export function providerLabel(providerId: string): string {
  return PROVIDER_LABELS[providerId] ?? providerId;
}

export function threadModelRowLabel(args: {
  model: string | null | undefined;
  providerId: string;
}): string {
  return args.model ? modelLabel(args.model) : providerLabel(args.providerId);
}
