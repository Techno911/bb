import type { ThreadRuntimeDisplayStatus } from "@bb/domain";
import { stripModelBrandPrefix } from "@/components/pickers/model-brand-prefix";

/**
 * What the collapsed composer of an unfocused pane shows on its single line.
 *
 * The line used to read "Ask a follow-up" in every pane, which says nothing:
 * the one thing worth knowing about a thread you are not looking at is which
 * model is working in it. So the model takes that place — but only while the
 * thread can actually take a message. When it is starting, stopping or its
 * host is gone, that status is the more useful thing to read, and it stays.
 */
const STATUSES_THAT_KEEP_THEIR_TEXT: ReadonlySet<ThreadRuntimeDisplayStatus> =
  new Set([
    "provisioning",
    "starting",
    "stopping",
    "waiting-for-host",
    "host-reconnecting",
    "error",
  ]);

export interface CollapsedComposerSummaryArgs {
  displayStatus: ThreadRuntimeDisplayStatus;
  isStopRequested: boolean;
  modelLabel: string | undefined;
}

export function shouldShowModelInCollapsedComposer({
  displayStatus,
  isStopRequested,
  modelLabel,
}: CollapsedComposerSummaryArgs): boolean {
  if (isStopRequested) return false;
  if (STATUSES_THAT_KEEP_THEIR_TEXT.has(displayStatus)) return false;
  return modelLabel !== undefined && modelLabel.trim().length > 0;
}

interface LabelledOption {
  value: string;
  label: string;
}

/**
 * The label the model picker shows for the current model.
 *
 * Built the same way the picker builds it — option label, falling back to the
 * raw id, then the provider's brand prefix stripped — so the collapsed line and
 * the expanded composer cannot drift into naming the same model differently.
 */
export function collapsedComposerModelLabel({
  modelValue,
  modelOptions,
  brandPrefix,
}: {
  modelValue: string | undefined;
  modelOptions: readonly LabelledOption[];
  brandPrefix: string | undefined;
}): string | undefined {
  if (modelValue === undefined || modelValue.trim().length === 0) {
    return undefined;
  }
  const option = modelOptions.find((entry) => entry.value === modelValue);
  const label = option?.label ?? modelValue;
  const stripped = stripModelBrandPrefix(label, brandPrefix).trim();
  return stripped.length > 0 ? stripped : undefined;
}
