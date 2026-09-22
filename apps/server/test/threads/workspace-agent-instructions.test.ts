import { describe, expect, it, vi } from "vitest";
import { ApiError } from "../../src/errors.js";

const rpcMock = vi.fn();
vi.mock("../../src/services/hosts/online-rpc.js", () => ({
  callHostRetryableOnlineRpc: (...args: unknown[]) => rpcMock(...args),
}));

const { readWorkspaceAgentInstructions } = await import(
  "../../src/services/threads/workspace-agent-instructions.js"
);

function makeDeps() {
  const warn = vi.fn();
  return {
    deps: { logger: { warn } } as never,
    warn,
  };
}

const args = { hostId: "host-1", workspacePath: "/Users/me/Desktop/Проект" };

describe("readWorkspaceAgentInstructions", () => {
  it("returns the trimmed file content", async () => {
    rpcMock.mockResolvedValueOnce({
      content: "  Always run the smoke test.\n",
      contentEncoding: "utf8",
    });
    const { deps } = makeDeps();
    await expect(readWorkspaceAgentInstructions(deps, args)).resolves.toBe(
      "Always run the smoke test.",
    );
  });

  it("treats a missing file as no instructions", async () => {
    rpcMock.mockRejectedValueOnce(
      new ApiError(502, "ENOENT", "Path does not exist", false),
    );
    const { deps, warn } = makeDeps();
    await expect(readWorkspaceAgentInstructions(deps, args)).resolves.toBeNull();
    expect(warn).not.toHaveBeenCalled();
  });

  it.each(["EPERM", "EACCES", "EISDIR"])(
    "skips a file the host cannot read (%s) and says so",
    async (code) => {
      rpcMock.mockRejectedValueOnce(
        new ApiError(502, code, `${code}: operation not permitted`, false),
      );
      const { deps, warn } = makeDeps();
      await expect(
        readWorkspaceAgentInstructions(deps, args),
      ).resolves.toBeNull();
      expect(warn).toHaveBeenCalledTimes(1);
      expect(warn.mock.calls[0]?.[0]).toMatchObject({
        code,
        filePath: "/Users/me/Desktop/Проект/.bb/AGENTS.md",
      });
    },
  );

  it("still propagates host outages", async () => {
    rpcMock.mockRejectedValueOnce(
      new ApiError(502, "host_unavailable", "Host is not connected", false),
    );
    const { deps } = makeDeps();
    await expect(readWorkspaceAgentInstructions(deps, args)).rejects.toThrow(
      ApiError,
    );
  });
});
