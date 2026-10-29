import { spawn } from "node:child_process";
import * as readline from "node:readline";
import type {
  ExecutionOptions,
  ExecutionResult,
  SandboxContext,
  SandboxExecutor,
} from "../types.ts";

/**
 * Executes code inside a Deno subprocess with strict security isolation flags:
 * --no-net, --no-read, --no-write, --no-env
 */
export class DenoSandboxExecutor implements SandboxExecutor {
  public readonly name = "DenoSandbox";

  public async isAvailable(): Promise<boolean> {
    return new Promise((resolve) => {
      const child = spawn("deno", ["--version"], { stdio: "ignore", shell: true });
      child.on("error", () => resolve(false));
      child.on("exit", (code) => resolve(code === 0));
    });
  }

  public async execute(
    code: string,
    context: SandboxContext,
    options: ExecutionOptions = {}
  ): Promise<ExecutionResult> {
    const timeoutMs = options.timeoutMs ?? 15000;
    const memoryLimitMb = options.memoryLimitMb ?? 128;
    const startTime = Date.now();
    const logs: string[] = [];

    const harnessScript = this.generateDenoHarness(code);

    return new Promise<ExecutionResult>((resolve) => {
      let isSettled = false;
      let watchdog: NodeJS.Timeout | null = null;

      const safeResolve = (result: ExecutionResult) => {
        if (isSettled) return;
        isSettled = true;
        if (watchdog) clearTimeout(watchdog);
        resolve(result);
      };

      // Spawn Deno with strict capability security flags
      const denoArgs = [
        "run",
        "--no-net",
        "--no-read",
        "--no-write",
        "--no-env",
        `--v8-flags=--max-old-space-size=${memoryLimitMb}`,
        "-", // Read script from stdin
      ];

      const child = spawn("deno", denoArgs, {
        stdio: ["pipe", "pipe", "pipe"],
        env: {}, // Empty environment
        shell: true,
      });

      // Watchdog timer
      watchdog = setTimeout(() => {
        try {
          child.kill("SIGKILL");
        } catch {}
        safeResolve({
          success: false,
          error: `Deno execution timed out after ${timeoutMs}ms (infinite loop or hang prevented)`,
          logs,
          executionTimeMs: Date.now() - startTime,
        });
      }, timeoutMs);

      const rl = readline.createInterface({
        input: child.stdout,
        crlfDelay: Infinity,
      });

      rl.on("line", async (line) => {
        try {
          const msg = JSON.parse(line);
          if (msg.type === "CONSOLE_LOG") {
            logs.push(msg.payload);
          } else if (msg.type === "CALL_TOOL") {
            const { id, payload } = msg;
            try {
              const toolResult = await context.callTool(payload.tool, payload.arguments || {});
              child.stdin.write(
                JSON.stringify({ type: "TOOL_RESULT", id, payload: toolResult }) + "\n"
              );
            } catch (err: any) {
              child.stdin.write(
                JSON.stringify({
                  type: "TOOL_ERROR",
                  id,
                  payload: err instanceof Error ? err.message : String(err),
                }) + "\n"
              );
            }
          } else if (msg.type === "EXECUTION_COMPLETE") {
            try {
              child.kill();
            } catch {}
            safeResolve({
              success: true,
              result: msg.payload,
              logs,
              executionTimeMs: Date.now() - startTime,
            });
          } else if (msg.type === "EXECUTION_ERROR") {
            try {
              child.kill();
            } catch {}
            safeResolve({
              success: false,
              error: msg.payload,
              logs,
              executionTimeMs: Date.now() - startTime,
            });
          }
        } catch {
          // Non-JSON output (regular stdout)
          logs.push(line);
        }
      });

      child.stderr.on("data", (data) => {
        const text = data.toString().trim();
        if (text) logs.push(`[stderr] ${text}`);
      });

      child.on("error", (err) => {
        safeResolve({
          success: false,
          error: `Failed to spawn Deno process: ${err.message}`,
          logs,
          executionTimeMs: Date.now() - startTime,
        });
      });

      child.on("exit", (code) => {
        if (!isSettled && code !== 0) {
          safeResolve({
            success: false,
            error: `Deno exited unexpectedly with code ${code}`,
            logs,
            executionTimeMs: Date.now() - startTime,
          });
        }
      });

      // Send the harness code to Deno via stdin
      child.stdin.write(harnessScript);
      child.stdin.end();
    });
  }

  private generateDenoHarness(userCode: string): string {
    return `
const pendingResponses = new Map();
let reqIdCounter = 0;

// Log interceptor
console.log = (...args) => {
  const line = args.map(a => typeof a === "object" ? JSON.stringify(a) : String(a)).join(" ");
  Deno.stdout.writeSync(new TextEncoder().encode(JSON.stringify({ type: "CONSOLE_LOG", payload: line }) + "\\n"));
};

// Simple stdin line reader in Deno
const decoder = new TextDecoder();
let buffer = "";

async function readLines() {
  const buf = new Uint8Array(4096);
  while (true) {
    const bytesRead = await Deno.stdin.read(buf);
    if (bytesRead === null) break;
    buffer += decoder.decode(buf.subarray(0, bytesRead));
    const lines = buffer.split("\\n");
    buffer = lines.pop() || "";
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const msg = JSON.parse(line);
        if (msg.type === "TOOL_RESULT" || msg.type === "TOOL_ERROR") {
          const pending = pendingResponses.get(msg.id);
          if (pending) {
            pendingResponses.delete(msg.id);
            if (msg.type === "TOOL_RESULT") pending.resolve(msg.payload);
            else pending.reject(new Error(msg.payload));
          }
        }
      } catch {}
    }
  }
}

readLines();

function createMcpProxy(segments = []) {
  const invoke = (args = {}) => {
    return new Promise((resolve, reject) => {
      const id = "deno_call_" + Date.now() + "_" + (++reqIdCounter);
      pendingResponses.set(id, { resolve, reject });
      const msg = JSON.stringify({
        type: "CALL_TOOL",
        id: id,
        payload: { tool: segments.join("."), path: segments, arguments: args }
      }) + "\\n";
      Deno.stdout.writeSync(new TextEncoder().encode(msg));
    });
  };

  return new Proxy(invoke, {
    get: (_target, prop) => {
      if (typeof prop !== "string") return undefined;
      if (
        prop === "then" ||
        prop === "catch" ||
        prop === "finally" ||
        prop === "toJSON" ||
        prop === "toString" ||
        prop === "valueOf" ||
        prop === "inspect"
      ) {
        return undefined;
      }
      return createMcpProxy([...segments, prop]);
    }
  });
}

const mcp = createMcpProxy([]);

async function main() {
  try {
    const wrappedCode = ${JSON.stringify(userCode)};
    const executor = new Function("mcp", "console", \`
      return (async () => {
        \${wrappedCode}
      })();
    \`);
    const result = await executor(mcp, console);
    const msg = JSON.stringify({
      type: "EXECUTION_COMPLETE",
      payload: result !== undefined ? result : null
    }) + "\\n";
    Deno.stdout.writeSync(new TextEncoder().encode(msg));
  } catch (err) {
    const msg = JSON.stringify({
      type: "EXECUTION_ERROR",
      payload: err instanceof Error ? err.message : String(err)
    }) + "\\n";
    Deno.stdout.writeSync(new TextEncoder().encode(msg));
  }
}

main();
`;
  }
}

