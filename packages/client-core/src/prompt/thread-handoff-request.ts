import type {
  PermissionMode,
  PromptTextMention,
  ReasoningLevel,
  ServiceTier,
} from "@bb/domain";
import {
  permissionModeSchema,
  reasoningLevelSchema,
  serviceTierSchema,
} from "@bb/domain";
import type { AppCreateThreadRequest } from "../api-types.js";
import { promptDraftToInput, type PromptDraftState } from "./prompt-draft.js";

export interface ThreadHandoffCreateSeed {
  environmentId: string | null;
  projectId: string;
  sourceThreadId: string;
  sourceThreadTitle: string;
}

export const THREAD_HANDOFF_CREATE_TARGET_LOCATION_STATE_KEY =
  "threadHandoffCreateTarget";

export function buildThreadHandoffPromptDraft(
  seed: ThreadHandoffCreateSeed,
): PromptDraftState {
  const prefix = "Continue from ";
  const mentionText = `@thread:${seed.sourceThreadId}`;
  const text = `${prefix}${mentionText}`;
  const mention: PromptTextMention = {
    start: prefix.length,
    end: prefix.length + mentionText.length,
    resource: {
      kind: "thread",
      projectId: seed.projectId,
      threadId: seed.sourceThreadId,
      label: seed.sourceThreadTitle,
    },
  };

  return { text, mentions: [mention], attachments: [] };
}

const THREAD_HANDOFF_FOLLOW_UP_SEPARATOR = "\n\n";

export interface ThreadHandoffExecutionSelection {
  providerId: string;
  model: string;
  reasoningLevel: ReasoningLevel;
  serviceTier: ServiceTier | undefined;
  supportsServiceTier: boolean;
  permissionMode: PermissionMode;
}

export interface ThreadHandoffCreateTarget {
  execution: ThreadHandoffExecutionSelection;
  seed: ThreadHandoffCreateSeed;
}

interface ThreadHandoffLocationState extends Record<string, unknown> {
  focusPrompt: true;
  reuseEnvironmentId?: string;
  [THREAD_HANDOFF_CREATE_TARGET_LOCATION_STATE_KEY]: ThreadHandoffCreateTarget;
}

export function buildThreadHandoffLocationState(
  target: ThreadHandoffCreateTarget,
): ThreadHandoffLocationState {
  return {
    focusPrompt: true,
    ...(target.seed.environmentId !== null
      ? { reuseEnvironmentId: target.seed.environmentId }
      : {}),
    [THREAD_HANDOFF_CREATE_TARGET_LOCATION_STATE_KEY]: target,
  };
}

export function readThreadHandoffCreateTargetFromLocationState(
  state: unknown,
): ThreadHandoffCreateTarget | null {
  if (!state || typeof state !== "object") return null;
  const candidate = (state as Record<string, unknown>)[
    THREAD_HANDOFF_CREATE_TARGET_LOCATION_STATE_KEY
  ];
  if (!candidate || typeof candidate !== "object") return null;
  const target = candidate as Record<string, unknown>;
  if (!target.seed || typeof target.seed !== "object") return null;
  if (!target.execution || typeof target.execution !== "object") return null;
  const seed = target.seed as Record<string, unknown>;
  const execution = target.execution as Record<string, unknown>;
  if (
    typeof seed.projectId !== "string" ||
    seed.projectId.length === 0 ||
    typeof seed.sourceThreadId !== "string" ||
    seed.sourceThreadId.length === 0 ||
    typeof seed.sourceThreadTitle !== "string" ||
    seed.sourceThreadTitle.trim().length === 0 ||
    (seed.environmentId !== null &&
      typeof seed.environmentId !== "string") ||
    typeof execution.providerId !== "string" ||
    execution.providerId.length === 0 ||
    typeof execution.model !== "string" ||
    execution.model.length === 0 ||
    !reasoningLevelSchema.safeParse(execution.reasoningLevel).success ||
    !permissionModeSchema.safeParse(execution.permissionMode).success ||
    (execution.serviceTier !== undefined &&
      !serviceTierSchema.safeParse(execution.serviceTier).success) ||
    typeof execution.supportsServiceTier !== "boolean"
  ) {
    return null;
  }
  return {
    seed: {
      environmentId:
        typeof seed.environmentId === "string" && seed.environmentId.length > 0
          ? seed.environmentId
          : null,
      projectId: seed.projectId,
      sourceThreadId: seed.sourceThreadId,
      sourceThreadTitle: seed.sourceThreadTitle.trim(),
    },
    execution: {
      providerId: execution.providerId,
      model: execution.model,
      reasoningLevel: execution.reasoningLevel as ReasoningLevel,
      serviceTier: execution.serviceTier as ServiceTier | undefined,
      supportsServiceTier: execution.supportsServiceTier,
      permissionMode: execution.permissionMode as PermissionMode,
    },
  };
}

interface BuildThreadHandoffCreateRequestArgs {
  draft: PromptDraftState;
  execution: ThreadHandoffExecutionSelection;
  seed: ThreadHandoffCreateSeed;
  sendAt?: number;
}

function threadHandoffPrefixLength(
  seed: ThreadHandoffCreateSeed,
  draft: PromptDraftState,
): number | null {
  const handoff = buildThreadHandoffPromptDraft(seed);
  const [handoffMention] = handoff.mentions;
  const hasHandoffMention =
    handoffMention !== undefined &&
    draft.mentions.some(
      (mention) =>
        mention.start === handoffMention.start &&
        mention.end === handoffMention.end &&
        mention.resource.kind === "thread" &&
        mention.resource.threadId === seed.sourceThreadId,
    );
  if (!hasHandoffMention || !draft.text.startsWith(handoff.text)) {
    return null;
  }
  let prefixLength = handoff.text.length;
  if (prefixLength < draft.text.length && draft.text[prefixLength] !== "\n") {
    return null;
  }
  while (draft.text[prefixLength] === "\n") {
    prefixLength += 1;
  }
  return prefixLength;
}

export function buildThreadHandoffFollowUpDraft(
  seed: ThreadHandoffCreateSeed,
  draft: PromptDraftState,
): PromptDraftState {
  if (threadHandoffPrefixLength(seed, draft) !== null) {
    return draft;
  }
  const handoff = buildThreadHandoffPromptDraft(seed);
  const offset =
    handoff.text.length + THREAD_HANDOFF_FOLLOW_UP_SEPARATOR.length;
  return {
    text: `${handoff.text}${THREAD_HANDOFF_FOLLOW_UP_SEPARATOR}${draft.text}`,
    mentions: [
      ...handoff.mentions,
      ...draft.mentions.map((mention) => ({
        ...mention,
        start: mention.start + offset,
        end: mention.end + offset,
      })),
    ],
    attachments: draft.attachments,
  };
}

export function stripThreadHandoffPrefix(
  seed: ThreadHandoffCreateSeed,
  draft: PromptDraftState,
): PromptDraftState | null {
  const prefixLength = threadHandoffPrefixLength(seed, draft);
  if (prefixLength === null) {
    return null;
  }
  return {
    text: draft.text.slice(prefixLength),
    mentions: draft.mentions
      .filter((mention) => mention.start >= prefixLength)
      .map((mention) => ({
        ...mention,
        start: mention.start - prefixLength,
        end: mention.end - prefixLength,
      })),
    attachments: draft.attachments,
  };
}

export function buildThreadHandoffCreateRequest({
  draft,
  execution,
  seed,
  sendAt,
}: BuildThreadHandoffCreateRequestArgs): AppCreateThreadRequest | null {
  const input = promptDraftToInput(draft);
  if (execution.model.length === 0 || input.length === 0) {
    return null;
  }

  return {
    environment:
      seed.environmentId === null
        ? { type: "project-default" }
        : { type: "reuse", environmentId: seed.environmentId },
    executionInputSources: {
      providerId: "explicit",
      model: "explicit",
      reasoningLevel: "explicit",
      permissionMode: "explicit",
      ...(execution.supportsServiceTier && execution.serviceTier
        ? { serviceTier: "explicit" as const }
        : {}),
    },
    input,
    model: execution.model,
    parentThreadId: seed.sourceThreadId,
    permissionMode: execution.permissionMode,
    projectId: seed.projectId,
    providerId: execution.providerId,
    reasoningLevel: execution.reasoningLevel,
    ...(execution.supportsServiceTier && execution.serviceTier
      ? { serviceTier: execution.serviceTier }
      : {}),
    ...(sendAt === undefined ? {} : { sendAt }),
    startedOnBehalfOf: null,
  };
}
