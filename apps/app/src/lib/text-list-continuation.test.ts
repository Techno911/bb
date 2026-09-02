import { describe, expect, it } from "vitest";
import {
  planTextListContinuation,
  planTextareaListContinuation,
  renumberOrderedListLines,
} from "./text-list-continuation";

describe("planTextListContinuation", () => {
  it("numbers the next item", () => {
    expect(planTextListContinuation("1. first", 8)).toEqual({
      kind: "continue",
      prefix: "2. ",
      renumberFrom: { indent: "", delimiter: ".", nextNumber: 3 },
    });
    expect(planTextListContinuation("9) ninth", 8)).toEqual({
      kind: "continue",
      prefix: "10) ",
      renumberFrom: { indent: "", delimiter: ")", nextNumber: 11 },
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
      renumberFrom: { indent: "", delimiter: ".", nextNumber: 2028 },
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
      renumberFrom: { indent: "", delimiter: ".", nextNumber: 3 },
    });
  });
});

describe("renumberOrderedListLines", () => {
  it("bumps the tail that used to sit right after the split point", () => {
    // Repro of the bug Артём hit: splitting item 1 leaves the old item 2
    // reading "2." right below the new item, which also reads "2.".
    expect(renumberOrderedListLines(["2. Пока меня интересуют..."], "", ".", 3)).toEqual([
      "3. Пока меня интересуют...",
    ]);
  });

  it("renumbers several items in a row", () => {
    expect(
      renumberOrderedListLines(["2. second", "3. third", "4. fourth"], "", ".", 3),
    ).toEqual(["3. second", "4. third", "5. fourth"]);
  });

  it("stops at the first line that is not the same ordered list", () => {
    expect(
      renumberOrderedListLines(
        ["2. second", "", "1. a different list"],
        "",
        ".",
        3,
      ),
    ).toEqual(["3. second", "", "1. a different list"]);
  });

  it("does not cross into a bullet list", () => {
    expect(renumberOrderedListLines(["- bullet"], "", ".", 3)).toBeNull();
  });

  it("does not cross into a different indent", () => {
    expect(renumberOrderedListLines(["  2. nested"], "", ".", 3)).toBeNull();
  });

  it("does not cross into a different delimiter", () => {
    expect(renumberOrderedListLines(["2) second"], "", ".", 3)).toBeNull();
  });

  it("keeps the checkbox and text of each line intact", () => {
    expect(renumberOrderedListLines(["2. [x] done"], "", ".", 5)).toEqual([
      "5. [x] done",
    ]);
  });

  it("returns null when nothing follows", () => {
    expect(renumberOrderedListLines([], "", ".", 2)).toBeNull();
  });

  it("returns null when the numbers already match", () => {
    expect(renumberOrderedListLines(["3. already right"], "", ".", 3)).toBeNull();
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

  it("bumps items that already sit below the split point (repro, Артём 01.09.2026)", () => {
    // Two items typed via two Shift+Enters, cursor back at the end of item 1,
    // Shift+Enter again: item 2 must become item 3, not stay item 2.
    const value = "1. first\n2. second";
    expect(planTextareaListContinuation(value, 8, 8)).toEqual({
      value: "1. first\n2. \n3. second",
      caret: 12,
    });
  });

  it("renumbers the whole tail, not just the very next item", () => {
    const value = "1. first\n2. second\n3. third";
    expect(planTextareaListContinuation(value, 8, 8)).toEqual({
      value: "1. first\n2. \n3. second\n4. third",
      caret: 12,
    });
  });

  it("stops renumbering at a blank line separating two lists", () => {
    const value = "1. first\n2. second\n\n1. other list";
    expect(planTextareaListContinuation(value, 8, 8)).toEqual({
      value: "1. first\n2. \n3. second\n\n1. other list",
      caret: 12,
    });
  });

  it("does not renumber a following bullet list", () => {
    const value = "1. first\n- bullet";
    expect(planTextareaListContinuation(value, 8, 8)).toEqual({
      value: "1. first\n2. \n- bullet",
      caret: 12,
    });
  });

  it("leaves a differently-indented following item alone", () => {
    const value = "1. first\n  2. nested";
    expect(planTextareaListContinuation(value, 8, 8)).toEqual({
      value: "1. first\n2. \n  2. nested",
      caret: 12,
    });
  });

  it("stands aside for selections and plain text", () => {
    expect(planTextareaListContinuation("1. first", 2, 5)).toBeNull();
    expect(planTextareaListContinuation("plain", 5, 5)).toBeNull();
  });
});
