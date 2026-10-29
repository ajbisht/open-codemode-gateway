import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { DownstreamClient } from "../src/adapter/downstream-client.ts";
import { CodeModeServer } from "../src/server/codemode-server.ts";
import { NodeWorkerSandboxExecutor } from "../src/sandbox/worker-executor.ts";

describe("OpenCodeMode End-to-End Integration", () => {
  it("orchestrates tools end-to-end through execute_code", async () => {
    // 1. Setup downstream client with mock database tools
    const mockDb = [
      { id: 101, customer: "Alice", amount: 250, status: "paid" },
      { id: 102, customer: "Bob", amount: 80, status: "pending" },
      { id: 103, customer: "Charlie", amount: 450, status: "paid" },
      { id: 104, customer: "David", amount: 120, status: "failed" },
    ];

    const downstream = new DownstreamClient();
    downstream.setMockTools([
      {
        name: "list_invoices",
        description: "Returns all customer invoices",
        inputSchema: {
          type: "object",
          properties: {
            status: { type: "string", enum: ["paid", "pending", "failed"] },
          },
        },
      },
      {
        name: "send_alert",
        description: "Sends an alert notification",
        inputSchema: {
          type: "object",
          properties: {
            message: { type: "string" },
          },
          required: ["message"],
        },
      },
    ]);

    // Mock tool handler
    (downstream as any).client = {
      callTool: async (params: { name: string; arguments?: Record<string, any> }) => {
        if (params.name === "list_invoices") {
          const filterStatus = params.arguments?.status;
          const filtered = filterStatus
            ? mockDb.filter((i) => i.status === filterStatus)
            : mockDb;
          return {
            content: [{ type: "text", text: JSON.stringify(filtered) }],
          };
        }
        if (params.name === "send_alert") {
          return {
            content: [{ type: "text", text: `Alert sent: ${params.arguments?.message}` }],
          };
        }
        return { isError: true, content: [{ type: "text", text: "Unknown tool" }] };
      },
    };

    // 2. Initialize CodeModeServer with isolated worker sandbox
    const server = new CodeModeServer({
      downstreamClient: downstream,
      sandboxExecutor: new NodeWorkerSandboxExecutor(),
    });

    // 3. Test list_tools handler
    const listHandler = (server as any).server._requestHandlers.get("tools/list");
    assert.ok(listHandler, "List tools handler must be registered");

    const listResult = await listHandler({ method: "tools/list", params: {} }, {});
    assert.strictEqual(listResult.tools.length, 2);

    const executeTool = listResult.tools.find((t: any) => t.name === "execute_code");
    assert.ok(executeTool);
    assert.ok(executeTool.description.includes("function list_invoices"));
    assert.ok(executeTool.description.includes("function send_alert"));

    // 4. Test call_tool with multi-step script
    const callHandler = (server as any).server._requestHandlers.get("tools/call");
    assert.ok(callHandler, "Call tool handler must be registered");

    const agentScript = `
      // LLM writes async code against mcp
      const invoices = await mcp.list_invoices();

      // In-memory data aggregation (saving context window tokens!)
      const paidInvoices = invoices.filter(inv => inv.status === "paid");
      const totalRevenue = paidInvoices.reduce((sum, inv) => sum + inv.amount, 0);

      // Call another tool conditionally based on calculation
      if (totalRevenue > 500) {
        await mcp.send_alert({ message: "Revenue milestone achieved: $" + totalRevenue });
      }

      return {
        paidCount: paidInvoices.length,
        totalRevenue: totalRevenue,
        highValueCustomer: paidInvoices.sort((a, b) => b.amount - a.amount)[0].customer
      };
    `;

    const callResult = await callHandler(
      {
        method: "tools/call",
        params: {
          name: "execute_code",
          arguments: { code: agentScript },
        },
      },
      {}
    );

    assert.ok(!callResult.isError, "Call should succeed without error");
    const parsedData = JSON.parse(callResult.content[0].text);
    assert.strictEqual(parsedData.paidCount, 2);
    assert.strictEqual(parsedData.totalRevenue, 700);
    assert.strictEqual(parsedData.highValueCustomer, "Charlie");
  });

  it("returns proper error payload when script fails syntax or execution", async () => {
    const downstream = new DownstreamClient();
    downstream.setMockTools([]);

    const server = new CodeModeServer({
      downstreamClient: downstream,
      sandboxExecutor: new NodeWorkerSandboxExecutor(),
    });

    const callHandler = (server as any).server._requestHandlers.get("tools/call");

    const failingScript = `
      throw new Error("Explicit business logic failure in agent code");
    `;

    const result = await callHandler(
      {
        method: "tools/call",
        params: {
          name: "execute_code",
          arguments: { code: failingScript },
        },
      },
      {}
    );

    assert.strictEqual(result.isError, true);
    assert.ok(result.content[0].text.includes("Explicit business logic failure in agent code"));
  });
});
