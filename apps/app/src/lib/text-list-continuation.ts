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

/** How to renumber the ordered items that already follow the split point. */
export interface ListRenumberPlan {
  indent: string;
  delimiter: string;
  /** The number the first following item should take, if it continues the list. */
  nextNumber: number;
}

export type TextListPlan =
  | { kind: "continue"; prefix: string; renumberFrom?: ListRenumberPlan }
  | { kind: "exit"; markerLength: number };

/**
 * Plans what happens when a new line starts inside `line`.
 *
 * Returns `continue` with the prefix the next line should carry, `exit` when the
 * item holds nothing but its marker (the writer is leaving the list), or null
 * when the line is not a list item at all.
 *
 * For an ordered item, `renumberFrom` also comes back: splitting an item in the
 * MIDDLE of a list (not just typing at its end) leaves every item already below
 * it one number behind — "2." inserted between "1." and the old "2." produces
 * two items reading "2." until those later items are bumped too. `renumberFrom`
 * carries what a caller with the rest of the document (`renumberOrderedListLines`
 * below) needs to fix that; a caller that only has this single line cannot fix
 * it alone, which is why the plan for that case used to just stop at "2.".
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

  // A checked box never carries over: the next item starts unchecked. This
  // applies to both bullets and ordered items, so it's computed once.
  const nextCheckbox = checkbox === undefined ? "" : checkbox.replace(/[xX]/, " ");

  if (bullet !== undefined) {
    return { kind: "continue", prefix: `${indent}${bullet}${spacing}${nextCheckbox}` };
  }

  const resolvedDelimiter = delimiter ?? ".";
  const currentNumber = Number(ordered);
  return {
    kind: "continue",
    prefix: `${indent}${currentNumber + 1}${resolvedDelimiter}${spacing}${nextCheckbox}`,
    renumberFrom: {
      indent,
      delimiter: resolvedDelimiter,
      nextNumber: currentNumber + 2,
    },
  };
}

/**
 * Renumbers the ordered items at the START of `lines` that continue the same
 * list — same indent, same delimiter, still ordered — leaving everything from
 * the first non-matching line onward untouched. A blank line, a switch to
 * bullets, or a different indent all end the list, same as a reader would read
 * it.
 *
 * Returns `null` when nothing needed to change, so a caller can skip building
 * a transaction for a plan whose split happened at the end of the list, where
 * there is no tail to fix.
 */
export function renumberOrderedListLines(
  lines: readonly string[],
  indent: string,
  delimiter: string,
  startNumber: number,
): string[] | null {
  let changed = false;
  let number = startNumber;
  const result: string[] = [];
  for (const line of lines) {
    const match = LIST_MARKER.exec(line);
    const isOrderedContinuation =
      match !== null &&
      match[2] === undefined && // group 2 is the bullet char; ordered items skip it
      match[1] === indent &&
      match[4] === delimiter;
    if (!isOrderedContinuation) break;

    const [marker, , , , , spacing, checkbox] = match;
    const rest = line.slice(marker.length);
    const fixed = `${indent}${number}${delimiter}${spacing}${checkbox ?? ""}${rest}`;
    result.push(fixed);
    if (fixed !== line) changed = true;
    number += 1;
  }
  if (!changed) return null;
  return result.concat(lines.slice(result.length));
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
  // Everything from the caret to the end of the CURRENT line is plain text
  // (or empty, when the caret sits at the end of the line) and is left alone.
  const tailOfCurrentLine = value.slice(selectionStart, lineEnd);
  // Everything from the end of the current line onward — starting with the
  // "\n" before the next line, or "" if this was the last line — is where a
  // list that already continued below the split point needs bumping.
  const restAfterLine = value.slice(lineEnd);
  const renumbered =
    plan.renumberFrom && restAfterLine !== ""
      ? renumberOrderedListLines(
          restAfterLine.slice(1).split("\n"),
          plan.renumberFrom.indent,
          plan.renumberFrom.delimiter,
          plan.renumberFrom.nextNumber,
        )
      : null;
  const fixedRestAfterLine =
    renumbered === null ? restAfterLine : `\n${renumbered.join("\n")}`;

  return {
    value:
      value.slice(0, selectionStart) + inserted + tailOfCurrentLine + fixedRestAfterLine,
    caret: selectionStart + inserted.length,
  };
}
