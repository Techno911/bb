import type { Editor } from "@tiptap/core";
import type { Node } from "@tiptap/pm/model";
import type { EditorState, Transaction } from "@tiptap/pm/state";
import {
  planTextListContinuation,
  renumberOrderedListLines,
  type ListRenumberPlan,
} from "@bb/shared-ui/lib/text-list-continuation";
import { createPromptParagraphNewlineTransaction } from "./prompt-editor-paragraph";

/**
 * The smallest edit that turns `oldText` into `newText` — the common prefix
 * and suffix are left alone, only the middle changes.
 *
 * Renumbering "2. second" to "3. second" is a one-character edit at offset 0,
 * not a rewrite of the whole line: replacing the whole paragraph's text would
 * also discard any inline content the plain digits-and-dot rewrite has no
 * business touching (a mention, a link — whatever richText marks are still
 * enabled reach into these paragraphs).
 */
function shortestReplacement(
  oldText: string,
  newText: string,
): { start: number; end: number; text: string } | null {
  if (oldText === newText) return null;
  const maxPrefix = Math.min(oldText.length, newText.length);
  let prefix = 0;
  while (prefix < maxPrefix && oldText[prefix] === newText[prefix]) prefix += 1;
  const maxSuffix = maxPrefix - prefix;
  let suffix = 0;
  while (
    suffix < maxSuffix &&
    oldText[oldText.length - 1 - suffix] ===
      newText[newText.length - 1 - suffix]
  ) {
    suffix += 1;
  }
  return {
    start: prefix,
    end: oldText.length - suffix,
    text: newText.slice(prefix, newText.length - suffix),
  };
}

/**
 * Bumps the ordered items that already sit below the split point.
 *
 * Splitting "1. first" into "1. first" / "2. " when a "2. second" already
 * follows leaves both items reading "2." — the plan only knows about the
 * single line it split, not the rest of the document. This walks the
 * paragraphs after `boundary` (the position right after the newly-split
 * paragraph, in `transaction`'s CURRENT document) and, for however many keep
 * the same list going, edits only their digits — same rule the plan already
 * used to decide whether to bump them at all.
 */
function renumberFollowingParagraphs(
  transaction: Transaction,
  boundary: number,
  plan: ListRenumberPlan,
): void {
  const paragraphs: { pos: number; node: Node }[] = [];
  transaction.doc.forEach((node, offset) => {
    if (offset >= boundary) paragraphs.push({ pos: offset, node });
  });
  if (paragraphs.length === 0) return;

  const lines = paragraphs.map((p) => p.node.textContent);
  const renumbered = renumberOrderedListLines(
    lines,
    plan.indent,
    plan.delimiter,
    plan.nextNumber,
  );
  if (renumbered === null) return;

  // Right to left: an edit only ever shifts positions to ITS right, so
  // earlier paragraphs' recorded positions stay valid without remapping.
  for (let i = paragraphs.length - 1; i >= 0; i -= 1) {
    const diff = shortestReplacement(lines[i], renumbered[i]);
    if (diff === null) continue;
    const contentStart = paragraphs[i].pos + 1;
    transaction.insertText(
      diff.text,
      contentStart + diff.start,
      contentStart + diff.end,
    );
  }
}

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

  const plan = planTextListContinuation(
    $from.parent.textContent,
    $from.parentOffset,
  );
  if (plan === null) return null;

  if (plan.kind === "exit") {
    const start = $from.start();
    const transaction = args.state.tr.delete(start, start + plan.markerLength);
    return transaction.docChanged ? transaction : null;
  }

  const transaction = createPromptParagraphNewlineTransaction(args);
  if (transaction === null) return null;
  transaction.insertText(plan.prefix, transaction.selection.from);

  if (plan.renumberFrom) {
    // `.after(1)` is the position right past the paragraph the caret just
    // landed in — the boundary where "whatever already followed" starts.
    const boundary = transaction.doc
      .resolve(transaction.selection.from)
      .after(1);
    renumberFollowingParagraphs(transaction, boundary, plan.renumberFrom);
  }

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
