import { describe, expect, it } from "vitest";
import {
  planTextListContinuation,
  planTextareaListContinuation,
} from "./text-list-continuation";

describe("planTextListContinuation", () => {
  it("numbers the next item", () => {
    expect(planTextListContinuation("1. first", 8)).toEqual({
      kind: "continue",
      prefix: "2. ",
    });
    expect(planTextListContinuation("9) ninth", 8)).toEqual({
      kind: "continue",
      prefix: "10) ",
    });
  });

  it("repeats bullets and keeps indentation", () => {
    expect(planTextListContinuation("- item", 6)).toEqual({
      kind: "continue",
      prefix: "- ",
    });
    expect(planTextListContinuation("    * nested", 12)).toEqual({
      kind: "continue",
      prefix: "    * ",
    });
    expect(planTextListContinuation("\t+ tabbed", 9)).toEqual({
      kind: "continue",
      prefix: "\t+ ",
    });
  });

  it("starts the next checkbox unchecked", () => {
    expect(planTextListContinuation("- [x] done", 10)).toEqual({
      kind: "continue",
      prefix: "- [ ] ",
    });
    expect(planTextListContinuation("- [ ] todo", 10)).toEqual({
      kind: "continue",
      prefix: "- [ ] ",
    });
  });

  it("leaves the list when the item holds only its marker", () => {
    expect(planTextListContinuation("3. ", 3)).toEqual({
      kind: "exit",
      markerLength: 3,
    });
    expect(planTextListContinuation("  - [ ] ", 8)).toEqual({
      kind: "exit",
      markerLength: 8,
    });
  });

  it("keeps out of the way of ordinary text", () => {
    expect(planTextListContinuation("plain line", 10)).toBeNull();
    expect(planTextListContinuation("1.no space", 10)).toBeNull();
    expect(planTextListContinuation("2026. a year", 12)).toEqual({
      kind: "continue",
      prefix: "2027. ",
    });
  });

  it("does nothing while the caret sits inside the marker", () => {
    expect(planTextListContinuation("1. first", 1)).toBeNull();
    expect(planTextListContinuation("- item", 1)).toBeNull();
    // Right after the marker the line is a list item, so it does continue.
    expect(planTextListContinuation("- item", 2)).toEqual({
      kind: "continue",
      prefix: "- ",
    });
  });

  it("splits mid-line and carries the tail along", () => {
    expect(planTextListContinuation("1. first half", 9)).toEqual({
      kind: "continue",
      prefix: "2. ",
    });
  });
});

describe("planTextareaListContinuation", () => {
  it("inserts the next marker at the caret", () => {
    const value = "1. first";
    expect(planTextareaListContinuation(value, value.length, value.length)).toEqual({
      value: "1. first\n2. ",
      caret: 12,
    });
  });

  it("continues the line the caret is on, not the first one", () => {
    const value = "intro\n- one\n- two";
    expect(planTextareaListContinuation(value, value.length, value.length)).toEqual({
      value: "intro\n- one\n- two\n- ",
      caret: 20,
    });
  });

  it("clears a marker-only line instead of adding another", () => {
    const value = "1. first\n2. ";
    expect(planTextareaListContinuation(value, value.length, value.length)).toEqual({
      value: "1. first\n",
      caret: 9,
    });
  });

  it("keeps the tail after the caret", () => {
    const value = "- one two";
    // Caret sits after "- one ", so "two" moves down behind the new marker.
    expect(planTextareaListContinuation(value, 6, 6)).toEqual({
      value: "- one \n- two",
      caret: 9,
    });
  });

  it("stands aside for selections and plain text", () => {
    expect(planTextareaListContinuation("1. first", 2, 5)).toBeNull();
    expect(planTextareaListContinuation("plain", 5, 5)).toBeNull();
  });
});
