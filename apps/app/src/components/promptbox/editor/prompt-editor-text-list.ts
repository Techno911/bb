import type { Editor } from "@tiptap/core";
import type { EditorState, Transaction } from "@tiptap/pm/state";
import { planTextListContinuation } from "@/lib/text-list-continuation";
import { createPromptParagraphNewlineTransaction } from "./prompt-editor-paragraph";

interface TextListEditorContext {
  extensionManager: {
    attributes: Editor["extensionManager"]["attributes"];
    splittableMarks?: Editor["extensionManager"]["splittableMarks"];
  };
}

/**
 * Continues a list typed as plain text.
 *
 * Rich text editing is off by default, so "1. first" stays an ordinary
 * paragraph and the structural list handling never sees it. This keeps the
 * writing flow anyway: the new line arrives carrying "2. ", and a line holding
 * nothing but its marker drops the marker instead of adding another one.
 */
export function createPromptTextListTransaction(args: {
  state: EditorState;
  editor: TextListEditorContext;
}): Transaction | null {
  const { selection } = args.state;
  if (!selection.empty) return null;

  const { $from } = selection;
  if ($from.parent.type.name !== "paragraph") return null;

  const plan = planTextListContinuation($from.parent.textContent, $from.parentOffset);
  if (plan === null) return null;

  if (plan.kind === "exit") {
    const start = $from.start();
    const transaction = args.state.tr.delete(start, start + plan.markerLength);
    return transaction.docChanged ? transaction : null;
  }

  const transaction = createPromptParagraphNewlineTransaction(args);
  if (transaction === null) return null;
  transaction.insertText(plan.prefix, transaction.selection.from);
  return transaction;
}

export function applyPromptTextListContinuation(editor: Editor): boolean {
  const transaction = createPromptTextListTransaction({
    state: editor.state,
    editor,
  });
  if (transaction === null) return false;
  editor.view.dispatch(transaction);
  return true;
}
