import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { NodeWorkerSandboxExecutor } from "../src/sandbox/worker-executor.ts";
import type { SandboxContext } from "../src/types.ts";

describe("Sandbox Security & Execution Tests", () => {
  const executor = new NodeWorkerSandboxExecutor();

  it("executes basic arithmetic and returns value", async () => {
    const context: SandboxContext = {
      tools: [],
      callTool: async () => {},
    };

    const res = await executor.execute("return 40 + 2;", context);
    assert.strictEqual(res.success, true);
    assert.strictEqual(res.result, 42);
  });

  it("calls downstream tools via the mcp proxy and aggregates results", async () => {
    // Mock database of items
    const database = [
      { id: 1, name: "Task A", status: "completed" },
      { id: 2, name: "Task B", status: "blocked" },
      { id: 3, name: "Task C", status: "in_progress" },
      { id: 4, name: "Task D", status: "blocked" },
    ];

    const context: SandboxContext = {
      tools: [
        {
          name: "fetch_tasks",
          inputSchema: { type: "object", properties: {} },
        },
      ],
      callTool: async (toolName, _args) => {
        if (toolName === "fetch_tasks") {
          return database;
        }
        throw new Error("Unknown tool");
      },
    };

    // Code mode in-memory filter script
    const script = `
      const allTasks = await mcp.fetch_tasks();
      // Filter blocked tasks inside sandbox
      const blocked = allTasks.filter(t => t.status === "blocked");
      return blocked.map(t => t.name);
    `;

    const res = await executor.execute(script, context);
    assert.strictEqual(res.success, true);
    assert.deepStrictEqual(res.result, ["Task B", "Task D"]);
  });

  it("prevents environment variable access (credentials leak prevention)", async () => {
    // Temporarily set a sensitive host environment variable
    process.env.SECRET_API_TOKEN = "super_secret_host_key_12345";

    const context: SandboxContext = {
      tools: [],
      callTool: async () => {},
    };

    const script = `
      return {
        hasEnv: typeof process !== "undefined" && typeof process.env !== "undefined",
        token: typeof process !== "undefined" && process.env ? process.env.SECRET_API_TOKEN : undefined
      };
    `;

    const res = await executor.execute(script, context);
    delete process.env.SECRET_API_TOKEN;

    assert.strictEqual(res.success, true);
    assert.strictEqual(res.result.token, undefined);
  });

  it("watchdog terminates infinite loops cleanly without hanging the host", async () => {
    const context: SandboxContext = {
      tools: [],
      callTool: async () => {},
    };

    const script = `
      // Adversarial payload: Infinite loop
      while (true) {}
    `;

    // 1 second timeout test
    const startTime = Date.now();
    const res = await executor.execute(script, context, { timeoutMs: 1000 });
    const elapsed = Date.now() - startTime;

    assert.strictEqual(res.success, false);
    assert.ok(res.error?.includes("timed out"));
    assert.ok(elapsed >= 950 && elapsed < 3500);
  });

  it("handles downstream tool errors gracefully", async () => {
    const context: SandboxContext = {
      tools: [],
      callTool: async () => {
        throw new Error("Database connection refused");
      },
    };

    const script = `
      try {
        await mcp.dangerous_call();
        return "should not reach here";
      } catch (err) {
        return "Caught tool error: " + err.message;
      }
    `;

    const res = await executor.execute(script, context);
    assert.strictEqual(res.success, true);
    assert.ok(String(res.result).includes("Database connection refused"));
  });

  it("captures console.log output without leaking to host stdout", async () => {
    const context: SandboxContext = {
      tools: [],
      callTool: async () => {},
    };

    const script = `
      console.log("Step 1: Initializing");
      console.log("Step 2: Processing with value", 99);
      return "Done";
    `;

    const res = await executor.execute(script, context);
    assert.strictEqual(res.success, true);
    assert.strictEqual(res.result, "Done");
    assert.strictEqual(res.logs.length, 2);
    assert.strictEqual(res.logs[0], "Step 1: Initializing");
    assert.strictEqual(res.logs[1], "Step 2: Processing with value 99");
  });
});

