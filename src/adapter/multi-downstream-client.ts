import { DownstreamClient } from "./downstream-client.ts";
import type { DownstreamServerConfig, McpToolDefinition, IDownstreamClient } from "../types.ts";

/**
 * Manages connections to multiple downstream MCP servers (spokes) concurrently,
 * aggregates their tool catalogs into clean namespaces, and routes tool calls
 * from the sandbox to the appropriate downstream spoke.
 */
export class MultiDownstreamClient implements IDownstreamClient {
  private serversConfig: Record<string, DownstreamServerConfig>;
  private clients: Map<string, DownstreamClient> = new Map();
  private mockSpokeTools: Map<string, McpToolDefinition[]> = new Map();
  private mockHandlers: Map<string, (toolName: string, args: Record<string, any>) => Promise<any>> = new Map();

  constructor(serversConfig: Record<string, DownstreamServerConfig> = {}) {
    this.serversConfig = serversConfig;
  }

  /**
   * Concurrently connects to all configured downstream MCP servers.
   */
  public async connect(): Promise<void> {
    const entries = Object.entries(this.serversConfig);
    if (entries.length === 0) {
      return;
    }

    const errors: string[] = [];

    await Promise.all(
      entries.map(async ([spokeName, config]) => {
        try {
          const client = new DownstreamClient(config);
          await client.connect();
          this.clients.set(spokeName, client);
        } catch (err: any) {
          errors.push(`[${spokeName}] Failed to connect: ${err.message}`);
        }
      })
    );

    if (errors.length > 0 && this.clients.size === 0) {
      throw new Error(`Failed to connect to downstream MCP servers:\n${errors.join("\n")}`);
    }
  }

  /**
   * Sets mock tools and handler for a spoke (useful for unit & integration testing).
   */
  public setMockSpokeTools(
    spokeName: string,
    tools: McpToolDefinition[],
    handler?: (toolName: string, args: Record<string, any>) => Promise<any>
  ): void {
    const tagged = tools.map((t) => ({ ...t, spoke: spokeName }));
    this.mockSpokeTools.set(spokeName, tagged);
    if (handler) {
      this.mockHandlers.set(spokeName, handler);
    }
  }

  /**
   * Returns aggregated tool definitions from all connected spokes,
   * with each tool annotated with its originating spoke.
   */
  public getTools(): McpToolDefinition[] {
    const allTools: McpToolDefinition[] = [];

    // Connected live clients
    for (const [spokeName, client] of this.clients.entries()) {
      const spokeTools = client.getTools();
      for (const tool of spokeTools) {
        allTools.push({
          ...tool,
          spoke: spokeName,
        });
      }
    }

    // Mock spokes
    for (const [, tools] of this.mockSpokeTools.entries()) {
      allTools.push(...tools);
    }

    return allTools;
  }

  /**
   * Dispatches a tool call to the designated downstream server.
   * Supports namespaced calls (e.g. "jira.create_issue") or direct names (e.g. "create_issue").
   */
  public async callTool(toolPath: string, args: Record<string, any>): Promise<any> {
    let targetSpoke: string | null = null;
    let targetTool = toolPath;

    if (toolPath.includes(".")) {
      const dotIndex = toolPath.indexOf(".");
      targetSpoke = toolPath.slice(0, dotIndex);
      targetTool = toolPath.slice(dotIndex + 1);
    } else {
      // Find which spoke owns this tool
      const matchingSpokes: string[] = [];

      // Check live clients
      for (const [spokeName, client] of this.clients.entries()) {
        if (client.getTools().some((t) => t.name === toolPath)) {
          matchingSpokes.push(spokeName);
        }
      }

      // Check mock spokes
      for (const [spokeName, tools] of this.mockSpokeTools.entries()) {
        if (tools.some((t) => t.name === toolPath)) {
          matchingSpokes.push(spokeName);
        }
      }

      if (matchingSpokes.length === 1) {
        targetSpoke = matchingSpokes[0];
      } else if (matchingSpokes.length > 1) {
        throw new Error(
          `Ambiguous tool call "${toolPath}". It exists on multiple spokes: [${matchingSpokes.join(
            ", "
          )}]. Please call using spoke prefix: mcp.${matchingSpokes[0]}.${toolPath}(...)`
        );
      } else if (this.clients.size === 1 && this.mockSpokeTools.size === 0) {
        targetSpoke = this.clients.keys().next().value || null;
      } else if (this.mockSpokeTools.size === 1 && this.clients.size === 0) {
        targetSpoke = this.mockSpokeTools.keys().next().value || null;
      }
    }

    if (!targetSpoke) {
      throw new Error(`Tool "${toolPath}" not found on any connected downstream MCP server`);
    }

    // Check mock handlers first
    const mockHandler = this.mockHandlers.get(targetSpoke);
    if (mockHandler) {
      return await mockHandler(targetTool, args);
    }

    // Check live clients
    const client = this.clients.get(targetSpoke);
    if (!client) {
      throw new Error(`Downstream spoke "${targetSpoke}" is not connected`);
    }

    return await client.callTool(targetTool, args);
  }

  /**
   * Safely closes all downstream client connections.
   */
  public async close(): Promise<void> {
    const closePromises = Array.from(this.clients.values()).map((c) => c.close());
    await Promise.all(closePromises);
    this.clients.clear();
    this.mockSpokeTools.clear();
    this.mockHandlers.clear();
  }
}

