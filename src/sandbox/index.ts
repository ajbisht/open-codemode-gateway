import type { SandboxExecutor } from "../types.ts";
import { DenoSandboxExecutor } from "./deno-executor.ts";
import { NodeWorkerSandboxExecutor } from "./worker-executor.ts";

export { DenoSandboxExecutor } from "./deno-executor.ts";
export { NodeWorkerSandboxExecutor } from "./worker-executor.ts";
export { IpcBridge } from "./ipc-bridge.ts";

/**
 * Creates the most secure available sandbox executor for the current environment.
 * Prefers Deno if installed; falls back to Node.js Worker Thread isolation.
 */
export async function createSandboxExecutor(preferred?: "deno" | "worker"): Promise<SandboxExecutor> {
  if (preferred === "deno") {
    return new DenoSandboxExecutor();
  }

  if (preferred === "worker") {
    return new NodeWorkerSandboxExecutor();
  }

  // Auto-detect: Check Deno first
  const deno = new DenoSandboxExecutor();
  if (await deno.isAvailable()) {
    return deno;
  }

  // Gracefully fallback to Worker
  return new NodeWorkerSandboxExecutor();
}

