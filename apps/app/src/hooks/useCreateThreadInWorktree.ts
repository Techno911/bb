import { useCallback } from "react";
import { useOpenNewThreadPane } from "@/hooks/useOpenNewThreadPane";

interface UseCreateThreadInWorktreeArgs {
  projectId: string;
  environmentId: string;
}

export function useCreateThreadInWorktree({
  projectId,
  environmentId,
}: UseCreateThreadInWorktreeArgs): () => void {
  const openNewThreadPane = useOpenNewThreadPane();
  return useCallback(() => {
    openNewThreadPane({
      projectId,
      state: { reuseEnvironmentId: environmentId },
    });
  }, [environmentId, openNewThreadPane, projectId]);
}
