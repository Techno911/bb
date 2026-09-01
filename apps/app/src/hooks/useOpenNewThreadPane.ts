import { useCallback } from "react";
import { useStore } from "jotai";
import { useIsCompactViewport } from "@bb/shared-ui/hooks/use-compact-viewport";
import { getRootComposeRoutePath } from "@/lib/route-paths";
import { openPaneContentInSplit } from "@/lib/split-layout/openPaneContentInSplit";
import { useSetRootComposeProjectId } from "@/lib/root-compose-selection";
import { useNavigate } from "react-router-dom";

const NEW_THREAD_PANE_CONTENT = { kind: "new-thread" } as const;

export interface OpenNewThreadPaneArgs {
  projectId?: string;
  replaceHistoryEntry?: boolean;
  state?: Record<string, unknown>;
}

export type OpenNewThreadPane = (args?: OpenNewThreadPaneArgs) => void;

export function useOpenNewThreadPane(): OpenNewThreadPane {
  const store = useStore();
  const navigate = useNavigate();
  const isCompactViewport = useIsCompactViewport();
  const setRootComposeProjectId = useSetRootComposeProjectId();

  return useCallback(
    (args: OpenNewThreadPaneArgs = {}) => {
      if (args.projectId !== undefined) {
        setRootComposeProjectId(args.projectId);
      }
      const state = { focusPrompt: true, ...(args.state ?? {}) };
      openPaneContentInSplit({
        store,
        navigate: (route, options) => {
          void navigate(route, {
            ...options,
            ...(args.replaceHistoryEntry ? { replace: true } : {}),
            state,
          });
        },
        content: NEW_THREAD_PANE_CONTENT,
        route: getRootComposeRoutePath(),
        enabled: !isCompactViewport,
      });
    },
    [isCompactViewport, navigate, setRootComposeProjectId, store],
  );
}
