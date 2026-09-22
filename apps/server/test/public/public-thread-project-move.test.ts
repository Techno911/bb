import { getThread } from "@bb/db";
import { threadSchema } from "@bb/domain";
import { describe, expect, it } from "vitest";
import { readJson } from "../helpers/json.js";
import {
  seedHostSession,
  seedProjectWithSource,
  seedThread,
} from "../helpers/seed.js";
import { withTestHarness } from "../helpers/test-app.js";

describe("moving a thread between projects", () => {
  it("moves the thread and its descendants into the target project", async () => {
    await withTestHarness(async (harness) => {
      const { host } = seedHostSession(harness.deps);
      const { project: source } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
        name: "Source",
        path: "/tmp/source-project",
      });
      const { project: target } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
        name: "Target",
        path: "/tmp/target-project",
      });
      const parent = seedThread(harness.deps, { projectId: source.id });
      const child = seedThread(harness.deps, {
        projectId: source.id,
        parentThreadId: parent.id,
      });
      const grandChild = seedThread(harness.deps, {
        projectId: source.id,
        parentThreadId: child.id,
      });
      const untouched = seedThread(harness.deps, { projectId: source.id });

      const response = await harness.app.request(
        `/api/v1/threads/${parent.id}`,
        {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ projectId: target.id }),
        },
      );

      expect(response.status).toBe(200);
      const updated = threadSchema.parse(await readJson(response));
      expect(updated.projectId).toBe(target.id);
      expect(getThread(harness.db, child.id)?.projectId).toBe(target.id);
      expect(getThread(harness.db, grandChild.id)?.projectId).toBe(target.id);
      expect(getThread(harness.db, untouched.id)?.projectId).toBe(source.id);
    });
  });

  it("keeps the thread section assignment and rejects an unknown project", async () => {
    await withTestHarness(async (harness) => {
      const { host } = seedHostSession(harness.deps);
      const { project: source } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
        name: "Source",
        path: "/tmp/source-project",
      });
      const thread = seedThread(harness.deps, { projectId: source.id });

      const missingProjectResponse = await harness.app.request(
        `/api/v1/threads/${thread.id}`,
        {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ projectId: "proj_missing" }),
        },
      );

      expect(missingProjectResponse.status).toBe(404);
      expect(getThread(harness.db, thread.id)?.projectId).toBe(source.id);
    });
  });
});
