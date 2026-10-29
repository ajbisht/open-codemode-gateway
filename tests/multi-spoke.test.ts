import { describe, it } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { MultiDownstreamClient } from "../src/adapter/multi-downstream-client.ts";
import { TypeGenerator } from "../src/adapter/type-generator.ts";
import { NodeWorkerSandboxExecutor } from "../src/sandbox/worker-executor.ts";
import { expandEnvVars, loadConfigFile, generateStarterConfig } from "../src/config.ts";
import type { McpToolDefinition } from "../src/types.ts";

describe("Multi-Spoke Configuration & Loading", () => {
  it("expands environment variables in config strings", () => {
    process.env.TEST_API_KEY = "secret-key-123";
    process.env.TEST_HOST = "api.internal.net";

    const expanded = expandEnvVars("Bearer ${TEST_API_KEY} at $TEST_HOST");
    assert.equal(expanded, "Bearer secret-key-123 at api.internal.net");
  });

  it("loads config file from custom path and generates starter template", async () => {
    const starterJson = generateStarterConfig();
    assert.ok(starterJson.includes("mcpServers"));
    const parsed = JSON.parse(starterJson);
    assert.ok(parsed.mcpServers.github);

    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "codemode-test-"));
    const tmpConfig = path.join(tmpDir, "codemode.config.json");
    fs.writeFileSync(tmpConfig, starterJson, "utf-8");

    const loaded = await loadConfigFile(tmpConfig);
    assert.ok(loaded);
    assert.ok(loaded.config.mcpServers.github);

    // Cleanup
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });
});

describe("Multi-Spoke Type Generator", () => {
  it("generates clean nested namespaces for multiple downstream spokes", () => {
    const tools: McpToolDefinition[] = [
      {
        name: "search_issues",
        spoke: "jira",
        description: "Search Jira tickets",
        inputSchema: {
          type: "object",
          properties: {
            jql: { type: "string", description: "JQL query" },
          },
          required: ["jql"],
        },
      },
      {
        name: "create_pull_request",
        spoke: "github",
        description: "Create a GitHub pull request",
        inputSchema: {
          type: "object",
          properties: {
            title: { type: "string" },
            head: { type: "string" },
            base: { type: "string" },
          },
          required: ["title", "head", "base"],
        },
      },
    ];

    const dts = TypeGenerator.generateNamespace(tools);

    assert.ok(dts.includes("namespace jira {"));
    assert.ok(dts.includes("namespace github {"));
    assert.ok(dts.includes("function search_issues(args: {"));
    assert.ok(dts.includes("function create_pull_request(args: {"));
  });
});

describe("MultiDownstreamClient & Sandbox Execution", () => {
  it("aggregates tools and routes calls to correct downstream spokes", async () => {
    const multi = new MultiDownstreamClient();

    let jiraCalled = false;
    let githubCalled = false;

    multi.setMockSpokeTools(
      "jira",
      [
        {
          name: "get_ticket",
          inputSchema: { type: "object", properties: { key: { type: "string" } } },
        },
      ],
      async (tool, args) => {
        jiraCalled = true;
        assert.equal(tool, "get_ticket");
        assert.equal(args.key, "PROJ-101");
        return { key: "PROJ-101", summary: "Fix login button", status: "Done" };
      }
    );

    multi.setMockSpokeTools(
      "github",
      [
        {
          name: "get_pr",
          inputSchema: { type: "object", properties: { prNumber: { type: "number" } } },
        },
      ],
      async (tool, args) => {
        githubCalled = true;
        assert.equal(tool, "get_pr");
        assert.equal(args.prNumber, 42);
        return { number: 42, title: "fix(auth): update button style", merged: true };
      }
    );

    const tools = multi.getTools();
    assert.equal(tools.length, 2);
    assert.equal(tools[0].spoke, "jira");
    assert.equal(tools[1].spoke, "github");

    // Call namespaced tools
    const jiraRes = await multi.callTool("jira.get_ticket", { key: "PROJ-101" });
    assert.equal(jiraRes.summary, "Fix login button");
    assert.ok(jiraCalled);

    const ghRes = await multi.callTool("github.get_pr", { prNumber: 42 });
    assert.equal(ghRes.merged, true);
    assert.ok(githubCalled);
  });

  it("orchestrates cross-spoke tools inside the sandbox in a single turn", async () => {
    const multi = new MultiDownstreamClient();

    multi.setMockSpokeTools(
      "jira",
      [
        {
          name: "list_issues",
          inputSchema: { type: "object", properties: {} },
        },
      ],
      async () => {
        return [
          { key: "ENG-1", prId: 101, status: "Closed" },
          { key: "ENG-2", prId: 102, status: "Open" },
          { key: "ENG-3", prId: 103, status: "Closed" },
        ];
      }
    );

    multi.setMockSpokeTools(
      "github",
      [
        {
          name: "get_pr",
          inputSchema: { type: "object", properties: { id: { type: "number" } } },
        },
      ],
      async (_tool, args) => {
        if (args.id === 101) return { id: 101, author: "alice", approved: true };
        if (args.id === 103) return { id: 103, author: "bob", approved: true };
        return { id: args.id, author: "charlie", approved: false };
      }
    );

    const sandbox = new NodeWorkerSandboxExecutor();

    // User script orchestrates both Jira and GitHub spokes in one shot
    const script = `
      const issues = await mcp.jira.list_issues();
      const closed = issues.filter(i => i.status === "Closed");
      
      const enriched = [];
      for (const issue of closed) {
        const pr = await mcp.github.get_pr({ id: issue.prId });
        enriched.push({
          ticket: issue.key,
          author: pr.author,
          approved: pr.approved
        });
      }
      
      return enriched;
    `;

    const result = await sandbox.execute(
      script,
      {
        tools: multi.getTools(),
        callTool: (toolName, args) => multi.callTool(toolName, args),
      },
      { timeoutMs: 5000 }
    );

    assert.equal(result.success, true);
    assert.deepEqual(result.result, [
      { ticket: "ENG-1", author: "alice", approved: true },
      { ticket: "ENG-3", author: "bob", approved: true },
    ]);
  });
});

