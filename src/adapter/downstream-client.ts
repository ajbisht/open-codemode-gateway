import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import type { DownstreamServerConfig, McpToolDefinition, IDownstreamClient } from "../types.ts";

/**
 * Manages connection to downstream MCP servers via standard transports (stdio/SSE)
 * and retrieves tool schemas or executes tool calls.
 */
export class DownstreamClient implements IDownstreamClient {
  private client: Client | null = null;
  private transport: StdioClientTransport | null = null;
  private toolsCache: McpToolDefinition[] = [];

  private config?: DownstreamServerConfig;

  constructor(config?: DownstreamServerConfig) {
    this.config = config;
  }

  /**
   * Connects to the downstream MCP server using stdio transport.
   */
  public async connect(): Promise<void> {
    if (!this.config || !this.config.command) {
      throw new Error("DownstreamClient requires a valid command to connect via stdio");
    }

    const cleanEnv: Record<string, string> = {};
    for (const [k, v] of Object.entries(process.env)) {
      if (typeof v === "string") cleanEnv[k] = v;
    }
    if (this.config.env) {
      Object.assign(cleanEnv, this.config.env);
    }

    this.transport = new StdioClientTransport({
      command: this.config.command,
      args: this.config.args || [],
      env: cleanEnv,
    });

    this.client = new Client(
      {
        name: "open-codemode-host",
        version: "0.1.0",
      },
      {
        capabilities: {},
      }
    );

    await this.client.connect(this.transport);
    await this.refreshTools();
  }

  /**
   * Refreshes the cached list of tools from the downstream server.
   */
  public async refreshTools(): Promise<McpToolDefinition[]> {
    if (!this.client) {
      throw new Error("DownstreamClient is not connected");
    }

    const response = await this.client.listTools();
    this.toolsCache = (response.tools || []).map((t) => ({
      name: t.name,
      description: t.description,
      inputSchema: (t.inputSchema as any) || { type: "object", properties: {} },
    }));

    return this.toolsCache;
  }

  /**
   * Gets the cached tools or empty array if not connected.
   */
  public getTools(): McpToolDefinition[] {
    return this.toolsCache;
  }

  /**
   * Sets the tools manually (useful for testing or synthetic connectors).
   */
  public setMockTools(tools: McpToolDefinition[]): void {
    this.toolsCache = tools;
  }

  /**
   * Calls a tool on the downstream MCP server.
   */
  public async callTool(toolName: string, args: Record<string, any>): Promise<any> {
    if (!this.client) {
      throw new Error(`Cannot call tool "${toolName}": DownstreamClient is not connected`);
    }

    const result = await this.client.callTool({
      name: toolName,
      arguments: args,
    });

    if (result.isError) {
      const errorText = (result.content as any[])
        ?.filter((c) => c.type === "text")
        ?.map((c) => c.text)
        ?.join("\n") || `Tool "${toolName}" returned an error`;
      throw new Error(errorText);
    }

    // Parse text contents or return structured content
    const contents = result.content as any[];
    if (contents && contents.length === 1 && contents[0].type === "text") {
      try {
        return JSON.parse(contents[0].text);
      } catch {
        return contents[0].text;
      }
    }

    return contents;
  }

  /**
   * Closes the connection to the downstream server safely.
   */
  public async close(): Promise<void> {
    if (this.client) {
      await this.client.close();
      this.client = null;
    }
    if (this.transport) {
      await this.transport.close();
      this.transport = null;
    }
  }
}
