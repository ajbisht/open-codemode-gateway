/**
 * Core protocol and execution types for OpenCodeMode
 */

export interface McpToolParameterSchema {
  type?: string;
  description?: string;
  properties?: Record<string, any>;
  required?: string[];
  items?: any;
  enum?: any[];
  [key: string]: any;
}

export interface McpToolDefinition {
  name: string;
  description?: string;
  inputSchema: McpToolParameterSchema;
  /** Optional spoke/server namespace (e.g. "github", "jira") */
  spoke?: string;
}

export interface DownstreamServerConfig {
  command?: string;
  args?: string[];
  url?: string;
  env?: Record<string, string>;
}

export interface CodeModeConfigFile {
  /** Map of downstream MCP servers (spokes) to connect to */
  mcpServers: Record<string, DownstreamServerConfig>;
  /** Optional execution constraints for the code execution sandbox */
  executionOptions?: ExecutionOptions;
}

export interface IDownstreamClient {
  connect(): Promise<void>;
  getTools(): McpToolDefinition[];
  callTool(toolName: string, args: Record<string, any>): Promise<any>;
  close(): Promise<void>;
}

export interface ExecutionOptions {
  /** Maximum time allowed for code execution in milliseconds (default: 15,000ms) */
  timeoutMs?: number;
  /** Maximum V8 old space memory in megabytes (default: 128MB) */
  memoryLimitMb?: number;
}

export interface ExecutionResult {
  success: boolean;
  result?: any;
  error?: string;
  logs: string[];
  executionTimeMs: number;
}

export interface SandboxContext {
  /** Map of tool definitions available to the script */
  tools: McpToolDefinition[];
  /** Handler to invoke a tool on the downstream MCP server via IPC bridge */
  callTool: (toolName: string, args: Record<string, any>) => Promise<any>;
}

export interface SandboxExecutor {
  name: string;
  /** Checks if the runtime (e.g. Deno) is installed and available */
  isAvailable(): Promise<boolean>;
  /** Executes code inside the sandbox with strict isolation */
  execute(
    code: string,
    context: SandboxContext,
    options?: ExecutionOptions
  ): Promise<ExecutionResult>;
}

export interface IpcMessage {
  id: string;
  type: "CALL_TOOL" | "TOOL_RESULT" | "TOOL_ERROR" | "EXECUTION_COMPLETE" | "EXECUTION_ERROR" | "CONSOLE_LOG";
  payload?: any;
}

