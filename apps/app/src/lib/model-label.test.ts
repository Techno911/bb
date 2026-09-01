import { describe, expect, it } from "vitest";
import { modelLabel, threadModelRowLabel } from "./model-label";

describe("modelLabel", () => {
  it("names Claude models by family and version", () => {
    expect(modelLabel("claude-fable-5-1")).toBe("Fable 5.1");
    expect(modelLabel("claude-opus-5[1m]")).toBe("Opus 5");
    expect(modelLabel("claude-sonnet-5")).toBe("Sonnet 5");
    expect(modelLabel("claude-haiku-4-5-20251001")).toBe("Haiku 4.5 20251001");
  });

  it("keeps other providers readable", () => {
    expect(modelLabel("gpt-5.6-sol")).toBe("GPT 5.6 Sol");
    expect(modelLabel("gpt-5")).toBe("GPT 5");
  });

  it("falls back to the raw id when nothing parses", () => {
    expect(modelLabel("best")).toBe("Best");
    expect(modelLabel("")).toBe("");
  });
});

describe("threadModelRowLabel", () => {
  it("prefers the pinned model and falls back to the provider", () => {
    expect(
      threadModelRowLabel({ model: "claude-fable-5-1", providerId: "claude-code" }),
    ).toBe("Fable 5.1");
    expect(threadModelRowLabel({ model: null, providerId: "claude-code" })).toBe("Claude");
    expect(threadModelRowLabel({ model: undefined, providerId: "codex" })).toBe("Codex");
    expect(threadModelRowLabel({ model: null, providerId: "acp-zed" })).toBe("acp-zed");
  });
});
