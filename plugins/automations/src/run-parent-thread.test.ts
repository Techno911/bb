import { describe, expect, it, vi } from "vitest";
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import plugin from "./server.js";
import { closeAutomationRunForSettledThread } from "./run.js";
import { createAutomationService } from "./service.js";

const PROJECT_ID = "proj_test";

type FakeThread = {
  id: string;
  archivedAt: number | null;
  deletedAt: number | null;
  status: "idle" | "active" | "starting" | "stopping" | "error";
};

async function createHost() {
  const threads = new Map<string, FakeThread>();
  const spawn = vi.fn(async () => {
    const thread: FakeThread = {
      id: `thr_run${spawn.mock.calls.length}`,
      archivedAt: null,
      deletedAt: null,
      status: "idle",
    };
    threads.set(thread.id, thread);
    return thread;
  });
  const send = vi.fn(async (_input: { threadId: string; mode: string }) => ({
    ok: true,
  }));
  const host = createFakePluginHost({
    pluginId: "automations",
    sdk: {
      projects: {
        async get({ projectId }) {
          return { id: projectId, name: "Test Project", deletedAt: null };
        },
        async list() {
          return [{ id: PROJECT_ID, name: "Test Project", deletedAt: null }];
        },
      },
      providers: {
        async list() {
          return [
            {
              id: "codex",
              capabilities: {
                permissionModes: ["accept-edits", "auto", "full"],
              },
            },
          ] as never;
        },
      },
      threads: {
        async get({ threadId }: { threadId: string }) {
          const thread = threads.get(threadId);
          if (!thread) {
            throw Object.assign(new Error("thread not found"), { status: 404 });
          }
          return thread;
        },
        send,
        spawn,
      },
    },
  });
  await plugin(host.bb as unknown as Parameters<typeof plugin>[0]);
  return { host, threads, spawn, send };
}

function createService(host: Awaited<ReturnType<typeof createHost>>["host"]) {
  return createAutomationService({
    bb: host.bb as never,
    db: host.bb.storage.database(),
    pluginDataDir: "/tmp/bb-automations-run-parent-test",
    serverUrl: "http://127.0.0.1:38886",
  });
}

async function createScheduledAutomation(
  service: ReturnType<typeof createService>,
  options: { freshThreadPerRun?: boolean; createdByThreadId?: string } = {},
) {
  return service.create({
    ...(options.createdByThreadId === undefined
      ? {}
      : { createdByThreadId: options.createdByThreadId }),
    projectId: PROJECT_ID,
    name: "Nightly check",
    enabled: true,
    trigger: {
      triggerType: "once",
      runAt: Date.now() + 60_000,
    },
    execution: {
      mode: "agent",
      prompt: "run the check",
      providerId: "codex",
      model: "gpt-5",
      reasoningLevel: "high",
      permissionMode: "accept-edits",
      environment: { type: "project-default" },
      ...(options.freshThreadPerRun ? { freshThreadPerRun: true } : {}),
    },
    origin: "human",
  });
}

async function runAndSettle(
  ctx: Awaited<ReturnType<typeof createHost>>,
  service: ReturnType<typeof createService>,
  automationId: string,
): Promise<string> {
  await service.run({ projectId: PROJECT_ID, automationId });
  const threadId = await vi.waitFor(() => {
    const run = service.runs({ projectId: PROJECT_ID, automationId, limit: 1 })
      .runs[0];
    expect(run?.status).toBe("running");
    expect(run?.threadId).toEqual(expect.any(String));
    return run!.threadId as string;
  });
  closeAutomationRunForSettledThread(
    ctx.host.bb as never,
    ctx.host.bb.storage.database(),
    {
      threadId,
      status: "idle",
    },
  );
  return threadId;
}

describe("automation runs land under the thread they were set up in", () => {
  it("parents the spawned run to the thread that created the automation", async () => {
    const ctx = await createHost();
    const service = createService(ctx.host);
    const automation = await createScheduledAutomation(service, {
      createdByThreadId: "thr_parent",
    });

    await runAndSettle(ctx, service, automation.id);

    expect(ctx.spawn).toHaveBeenCalledTimes(1);
    expect(ctx.spawn.mock.calls[0]?.[0]).toMatchObject({
      parentThreadId: "thr_parent",
    });

    await ctx.host.harness.dispose();
  });

  it("leaves an automation created outside any thread parentless", async () => {
    const ctx = await createHost();
    const service = createService(ctx.host);
    const automation = await createScheduledAutomation(service);

    await runAndSettle(ctx, service, automation.id);

    expect(ctx.spawn.mock.calls[0]?.[0]).not.toHaveProperty("parentThreadId");

    await ctx.host.harness.dispose();
  });

  it("keeps every later run under the same parent", async () => {
    const ctx = await createHost();
    const service = createService(ctx.host);
    const automation = await createScheduledAutomation(service, {
      freshThreadPerRun: true,
      createdByThreadId: "thr_parent",
    });

    await runAndSettle(ctx, service, automation.id);
    await runAndSettle(ctx, service, automation.id);

    expect(ctx.spawn).toHaveBeenCalledTimes(2);
    for (const call of ctx.spawn.mock.calls) {
      expect(call[0]).toMatchObject({ parentThreadId: "thr_parent" });
    }

    await ctx.host.harness.dispose();
  });
});
