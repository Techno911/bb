/**
 * Continuing plain-text lists when the caret moves to a new line.
 *
 * The prompt editor keeps rich text off by default, so a list typed as
 * "1. first" is ordinary text: pressing shift+enter used to leave the writer to
 * type "2. " by hand. These helpers describe what the next line should start
 * with, and they stay free of DOM and editor types so both surfaces that accept
 * prose (the tiptap prompt box and the plain textarea used for free-form
 * answers) share one behaviour.
 */

/** Marker groups: indentation, bullet, ordered number, delimiter, spacing, checkbox. */
const LIST_MARKER =
  /^([ \t]*)(?:([-*+])|(\d{1,9})([.)]))([ \t]+)(\[[ xX]\][ \t]+)?/;

export type TextListPlan =
  | { kind: "continue"; prefix: string }
  | { kind: "exit"; markerLength: number };

/**
 * Plans what happens when a new line starts inside `line`.
 *
 * Returns `continue` with the prefix the next line should carry, `exit` when the
 * item holds nothing but its marker (the writer is leaving the list), or null
 * when the line is not a list item at all.
 */
export function planTextListContinuation(
  line: string,
  caretOffset: number,
): TextListPlan | null {
  const match = LIST_MARKER.exec(line);
  if (match === null) return null;

  const [marker, indent, bullet, ordered, delimiter, spacing, checkbox] = match;
  // Inside the marker itself a new line should behave normally.
  if (caretOffset < marker.length) return null;

  const rest = line.slice(marker.length);
  if (rest.trim() === "") {
    return { kind: "exit", markerLength: marker.length };
  }

  const nextMarker =
    bullet !== undefined
      ? bullet
      : `${String(Number(ordered) + 1)}${delimiter ?? "."}`;
  // A checked box never carries over: the next item starts unchecked.
  const nextCheckbox = checkbox === undefined ? "" : checkbox.replace(/[xX]/, " ");
  return { kind: "continue", prefix: `${indent}${nextMarker}${spacing}${nextCheckbox}` };
}

export interface TextareaListContinuation {
  value: string;
  caret: number;
}

/**
 * Applies the same plan to a plain textarea value.
 *
 * Returns the value and caret position the field should take, or null when the
 * key press should keep its default behaviour.
 */
export function planTextareaListContinuation(
  value: string,
  selectionStart: number,
  selectionEnd: number,
): TextareaListContinuation | null {
  if (selectionStart !== selectionEnd) return null;

  const lineStart = value.lastIndexOf("\n", selectionStart - 1) + 1;
  const lineEndIndex = value.indexOf("\n", selectionStart);
  const lineEnd = lineEndIndex === -1 ? value.length : lineEndIndex;
  const line = value.slice(lineStart, lineEnd);

  const plan = planTextListContinuation(line, selectionStart - lineStart);
  if (plan === null) return null;

  if (plan.kind === "exit") {
    return {
      value: value.slice(0, lineStart) + value.slice(lineStart + plan.markerLength),
      caret: lineStart,
    };
  }

  const inserted = `\n${plan.prefix}`;
  return {
    value: value.slice(0, selectionStart) + inserted + value.slice(selectionStart),
    caret: selectionStart + inserted.length,
  };
}
