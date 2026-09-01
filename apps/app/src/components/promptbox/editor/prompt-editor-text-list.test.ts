import { describe, expect, it } from "vitest";
import { getSchema } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { Node } from "@tiptap/pm/model";
import { EditorState, TextSelection } from "@tiptap/pm/state";
import { promptEditorValueFromDoc } from "./prompt-editor-serialization";
import { createPromptTextListTransaction } from "./prompt-editor-text-list";

// Plain text editing: the list extensions the prompt box turns off by default.
const schema = getSchema([
  StarterKit.configure({
    blockquote: {},
    bold: false,
    bulletList: false,
    code: false,
    codeBlock: false,
    dropcursor: false,
    gapcursor: false,
    heading: false,
    horizontalRule: false,
    italic: false,
    link: false,
    listItem: false,
    orderedList: false,
    strike: false,
    underline: false,
  }),
]);

const editorContext = {
  extensionManager: { attributes: [], splittableMarks: [] },
};

function stateFromParagraphs(lines: string[], selectionPosition: number) {
  const doc = Node.fromJSON(schema, {
    type: "doc",
    content: lines.map((line) => ({
      type: "paragraph",
      ...(line === "" ? {} : { content: [{ type: "text", text: line }] }),
    })),
  });
  return EditorState.create({
    schema,
    doc,
    selection: TextSelection.create(doc, selectionPosition),
  });
}

function applied(state: EditorState) {
  const transaction = createPromptTextListTransaction({
    state,
    editor: editorContext,
  });
  if (transaction === null) return null;
  return promptEditorValueFromDoc(state.apply(transaction).doc).text;
}

describe("createPromptTextListTransaction", () => {
  it("carries the next number to the new line", () => {
    expect(applied(stateFromParagraphs(["1. first"], 9))).toBe("1. first\n2. ");
  });

  it("counts on from the line the caret is on", () => {
    // Two paragraphs: caret at the end of "2. second".
    expect(applied(stateFromParagraphs(["1. first", "2. second"], 20))).toBe(
      "1. first\n2. second\n3. ",
    );
  });

  it("repeats a bullet and keeps its indentation", () => {
    expect(applied(stateFromParagraphs(["  - item"], 9))).toBe("  - item\n  - ");
  });

  it("drops a marker that has nothing behind it", () => {
    expect(applied(stateFromParagraphs(["1. first", "2. "], 14))).toBe(
      "1. first\n",
    );
  });

  it("leaves ordinary paragraphs to the usual newline", () => {
    expect(applied(stateFromParagraphs(["just text"], 10))).toBeNull();
  });

  it("stands aside while the caret sits inside the marker", () => {
    expect(applied(stateFromParagraphs(["1. first"], 2))).toBeNull();
  });
});
