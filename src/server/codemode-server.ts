import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { TypeGenerator } from "../adapter/type-generator.ts";
import { createSandboxExecutor } from "../sandbox/index.ts";
import type { SandboxExecutor, ExecutionOptions, IDownstreamClient } from "../types.ts";

export interface CodeModeServerOptions {
  name?: string;
  version?: string;
  downstreamClient: IDownstreamClient;
  sandboxExecutor?: SandboxExecutor;
  executionOptions?: ExecutionOptions;
}

/**
 * Upstream MCP Server that presents the "Code Mode" interface to LLMs.
 * Exposes `execute_code` and `get_tool_types`.
 */
export class CodeModeServer {
  private server: Server;
  private downstream: IDownstreamClient;
  private sandbox: SandboxExecutor | null = null;
  private execOptions: ExecutionOptions;

  constructor(options: CodeModeServerOptions) {
    this.downstream = options.downstreamClient;
    this.sandbox = options.sandboxExecutor || null;
    this.execOptions = options.executionOptions || { timeoutMs: 15000, memoryLimitMb: 128 };

    this.server = new Server(
      {
        name: options.name || "open-codemode",
        version: options.version || "0.1.0",
      },
      {
        capabilities: {
          tools: {},
        },
      }
    );

    this.setupHandlers();
  }

  private async getSandbox(): Promise<SandboxExecutor> {
    if (!this.sandbox) {
      this.sandbox = await createSandboxExecutor();
    }
    return this.sandbox;
  }

  private setupHandlers(): void {
    // List tools handler
    this.server.setRequestHandler(ListToolsRequestSchema, async () => {
      const tools = this.downstream.getTools();
      const typeDefinitions = TypeGenerator.generateNamespace(tools);

      return {
        tools: [
          {
            name: "execute_code",
            description: [
              "Execute TypeScript/JavaScript code inside an isolated sandbox to orchestrate tools and filter data.",
              "Intermediate data stays in memory; return only the final result to save tokens.",
              "",
              "Available APIs on the global `mcp` object:",
              "```typescript",
              typeDefinitions,
              "```",
            ].join("\n"),
            inputSchema: {
              type: "object",
              properties: {
                code: {
                  type: "string",
                  description: "Async JavaScript/TypeScript snippet to execute (e.g. `const res = await mcp.my_tool(); return res.filter(...);`)",
                },
              },
              required: ["code"],
            },
          },
          {
            name: "get_tool_types",
            description: "Returns the complete TypeScript declaration file (.d.ts) describing all available downstream tools.",
            inputSchema: {
              type: "object",
              properties: {},
            },
          },
        ],
      };
    });

    // Call tool handler
    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;

      if (name === "get_tool_types") {
        const tools = this.downstream.getTools();
        const typeDefs = TypeGenerator.generateNamespace(tools);
        return {
          content: [
            {
              type: "text",
              text: typeDefs,
            },
          ],
        };
      }

      if (name === "execute_code") {
        const code = (args as any)?.code;
        if (!code || typeof code !== "string") {
          return {
            isError: true,
            content: [
              {
                type: "text",
                text: "Error: Missing or invalid 'code' argument. Provide a valid JavaScript snippet string.",
              },
            ],
          };
        }

        const sandbox = await this.getSandbox();
        const tools = this.downstream.getTools();

        const result = await sandbox.execute(
          code,
          {
            tools,
            callTool: async (toolName, toolArgs) => {
              return this.downstream.callTool(toolName, toolArgs);
            },
          },
          this.execOptions
        );

        if (!result.success) {
          const logOutput = result.logs.length > 0 ? `\n\nLogs:\n${result.logs.join("\n")}` : "";
          return {
            isError: true,
            content: [
              {
                type: "text",
                text: `Execution failed in ${result.executionTimeMs}ms:\n${result.error}${logOutput}`,
              },
            ],
          };
        }

        const formatted =
          typeof result.result === "string"
            ? result.result
            : JSON.stringify(result.result, null, 2);

        const logSection =
          result.logs.length > 0
            ? `\n\n[Sandbox Logs (${result.logs.length} entries)]:\n${result.logs.join("\n")}`
            : "";

        return {
          content: [
            {
              type: "text",
              text: (formatted !== undefined ? formatted : "Execution succeeded with no return value") + logSection,
            },
          ],
        };
      }

      return {
        isError: true,
        content: [
          {
            type: "text",
            text: `Unknown tool: ${name}`,
          },
        ],
      };
    });
  }

  /**
   * Starts the MCP server on stdio transport.
   */
  public async start(): Promise<void> {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
  }

  /**
   * Closes server and downstream connections.
   */
  public async stop(): Promise<void> {
    await this.server.close();
    await this.downstream.close();
  }
}

