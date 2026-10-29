import { Worker } from "node:worker_threads";
import type {
  ExecutionOptions,
  ExecutionResult,
  SandboxContext,
  SandboxExecutor,
} from "../types.ts";
import { generateWorkerCode } from "./harness-code.ts";

/**
 * Executes untrusted code inside an isolated Node.js Worker Thread
 * with zero environment variables, V8 heap memory constraints,
 * and a hard execution timeout watchdog.
 */
export class NodeWorkerSandboxExecutor implements SandboxExecutor {
  public readonly name = "NodeWorkerSandbox";

  public async isAvailable(): Promise<boolean> {
    return true; // Built into Node.js
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

    const workerScript = generateWorkerCode(code);

    return new Promise<ExecutionResult>((resolve) => {
      let isSettled = false;
      let watchdog: NodeJS.Timeout | null = null;

      const safeResolve = (result: ExecutionResult) => {
        if (isSettled) return;
        isSettled = true;
        if (watchdog) clearTimeout(watchdog);
        resolve(result);
      };

      // Instantiate isolated worker
      const worker = new Worker(workerScript, {
        eval: true,
        env: {}, // Completely empty environment - no host credentials or tokens
        resourceLimits: {
          maxOldGenerationSizeMb: memoryLimitMb,
        },
      });

      // Watchdog timer kills process on infinite loop
      watchdog = setTimeout(() => {
        safeResolve({
          success: false,
          error: `Execution timed out after ${timeoutMs}ms (infinite loop or hang prevented)`,
          logs,
          executionTimeMs: Date.now() - startTime,
        });
        worker.terminate().catch(() => {});
      }, timeoutMs);

      // Handle worker messages
      worker.on("message", async (msg) => {
        if (msg.type === "CONSOLE_LOG") {
          logs.push(msg.payload);
        } else if (msg.type === "CALL_TOOL") {
          const { id, payload } = msg;
          try {
            const toolResult = await context.callTool(payload.tool, payload.arguments || {});
            worker.postMessage({
              type: "TOOL_RESULT",
              id,
              payload: toolResult,
            });
          } catch (err: any) {
            worker.postMessage({
              type: "TOOL_ERROR",
              id,
              payload: err instanceof Error ? err.message : String(err),
            });
          }
        } else if (msg.type === "EXECUTION_COMPLETE") {
          safeResolve({
            success: true,
            result: msg.payload,
            logs,
            executionTimeMs: Date.now() - startTime,
          });
          worker.terminate().catch(() => {});
        } else if (msg.type === "EXECUTION_ERROR") {
          safeResolve({
            success: false,
            error: msg.payload,
            logs,
            executionTimeMs: Date.now() - startTime,
          });
          worker.terminate().catch(() => {});
        }
      });

      worker.on("error", async (err) => {
        await worker.terminate();
        safeResolve({
          success: false,
          error: `Worker crashed: ${err.message}`,
          logs,
          executionTimeMs: Date.now() - startTime,
        });
      });

      worker.on("exit", (exitCode) => {
        if (!isSettled && exitCode !== 0) {
          safeResolve({
            success: false,
            error: `Worker exited unexpectedly with code ${exitCode}`,
            logs,
            executionTimeMs: Date.now() - startTime,
          });
        }
      });
    });
  }
}
