import { listNonDeletedChildThreads, updateThread } from "@bb/db";
import type { AppDeps } from "../../types.js";

interface MoveThreadDescendantsToProjectArgs {
  threadId: string;
  projectId: string;
}

export function moveThreadDescendantsToProject(
  deps: Pick<AppDeps, "db" | "hub">,
  { threadId, projectId }: MoveThreadDescendantsToProjectArgs,
): number {
  const queue: string[] = [threadId];
  const visited = new Set<string>([threadId]);
  let movedCount = 0;
  while (queue.length > 0) {
    const parentThreadId = queue.shift();
    if (parentThreadId === undefined) break;
    for (const child of listNonDeletedChildThreads(deps.db, {
      parentThreadId,
    })) {
      if (visited.has(child.id)) continue;
      visited.add(child.id);
      queue.push(child.id);
      if (child.projectId === projectId) continue;
      updateThread(deps.db, deps.hub, child.id, { projectId });
      movedCount += 1;
    }
  }
  return movedCount;
}
