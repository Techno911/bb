import { describe, expect, it } from "vitest";
import {
  collapsedComposerModelLabel,
  shouldShowModelInCollapsedComposer,
} from "./collapsed-composer-summary.js";

describe("shouldShowModelInCollapsedComposer", () => {
  it("shows the model on a thread that can take a message", () => {
    for (const displayStatus of ["pending", "idle", "active"] as const) {
      expect(
        shouldShowModelInCollapsedComposer({
          displayStatus,
          isStopRequested: false,
          modelLabel: "Opus 5 1M",
        }),
      ).toBe(true);
    }
  });

  it("keeps the status text while the thread cannot take a message", () => {
    // The regression this guards: a pane that says "Opus 5 1M" while its host
    // is gone reads as ready, and the message the person types is lost.
    for (const displayStatus of [
      "provisioning",
      "starting",
      "stopping",
      "waiting-for-host",
      "host-reconnecting",
      "error",
    ] as const) {
      expect(
        shouldShowModelInCollapsedComposer({
          displayStatus,
          isStopRequested: false,
          modelLabel: "Opus 5 1M",
        }),
      ).toBe(false);
    }
  });

  it("keeps the status text while a stop was requested", () => {
    expect(
      shouldShowModelInCollapsedComposer({
        displayStatus: "active",
        isStopRequested: true,
        modelLabel: "Opus 5 1M",
      }),
    ).toBe(false);
  });

  it("falls back to the placeholder when no model is known", () => {
    for (const modelLabel of [undefined, "", "   "]) {
      expect(
        shouldShowModelInCollapsedComposer({
          displayStatus: "idle",
          isStopRequested: false,
          modelLabel,
        }),
      ).toBe(false);
    }
  });
});

describe("collapsedComposerModelLabel", () => {
  const modelOptions = [
    { value: "claude-opus-5[1m]", label: "Claude Opus 5 (1M)" },
    { value: "gpt-5.6-terra", label: "GPT-5.6-Terra" },
  ];

  it("uses the option label the picker shows", () => {
    expect(
      collapsedComposerModelLabel({
        modelValue: "gpt-5.6-terra",
        modelOptions,
        brandPrefix: undefined,
      }),
    ).toBe("GPT-5.6-Terra");
  });

  it("strips the provider brand prefix, as the picker trigger does", () => {
    // Otherwise the collapsed line reads "Claude Opus 5 (1M)" next to an
    // expanded composer that reads "Opus 5 (1M)" for the same thread.
    expect(
      collapsedComposerModelLabel({
        modelValue: "claude-opus-5[1m]",
        modelOptions,
        brandPrefix: "Claude",
      }),
    ).toBe("Opus 5 (1M)");
  });

  it("falls back to the raw id when the catalog has not loaded the model", () => {
    expect(
      collapsedComposerModelLabel({
        modelValue: "gpt-5.4",
        modelOptions,
        brandPrefix: undefined,
      }),
    ).toBe("gpt-5.4");
  });

  it("returns nothing when no model is selected", () => {
    for (const modelValue of [undefined, "", "   "]) {
      expect(
        collapsedComposerModelLabel({
          modelValue,
          modelOptions,
          brandPrefix: undefined,
        }),
      ).toBeUndefined();
    }
  });
});
