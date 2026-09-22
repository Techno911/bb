import { useCallback } from "react";
import { useOpenNewThreadPane } from "@/hooks/useOpenNewThreadPane";

interface UseCreateThreadInEnvironmentArgs {
  projectId: string;
  environmentId: string;
  sectionId: string | null;
}

export function useCreateThreadInEnvironment({
  projectId,
  environmentId,
  sectionId,
}: UseCreateThreadInEnvironmentArgs): () => void {
  const openNewThreadPane = useOpenNewThreadPane();
  return useCallback(() => {
    openNewThreadPane({
      projectId,
      state: { reuseEnvironmentId: environmentId, sectionId },
    });
  }, [environmentId, openNewThreadPane, projectId, sectionId]);
}
