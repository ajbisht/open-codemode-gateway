import type { IpcMessage } from "../types.ts";

/**
 * Manages request-response correlation and message encoding across the sandbox boundary.
 */
export class IpcBridge {
  private pendingRequests = new Map<
    string,
    {
      resolve: (value: any) => void;
      reject: (reason: any) => void;
      timeout: NodeJS.Timeout;
    }
  >();

  private messageCounter = 0;

  /**
   * Generates a unique message ID for request tracking.
   */
  public generateId(): string {
    this.messageCounter++;
    return `req_${Date.now()}_${this.messageCounter}`;
  }

  /**
   * Registers a pending request awaiting response from the opposite side.
   */
  public registerPending(
    id: string,
    resolve: (value: any) => void,
    reject: (reason: any) => void,
    timeoutMs: number = 15000
  ): void {
    const timeout = setTimeout(() => {
      this.pendingRequests.delete(id);
      reject(new Error(`IPC request ${id} timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    this.pendingRequests.set(id, { resolve, reject, timeout });
  }

  /**
   * Resolves a pending request with a tool response.
   */
  public handleResult(id: string, result: any): boolean {
    const pending = this.pendingRequests.get(id);
    if (!pending) return false;

    clearTimeout(pending.timeout);
    this.pendingRequests.delete(id);
    pending.resolve(result);
    return true;
  }

  /**
   * Rejects a pending request with an error.
   */
  public handleError(id: string, error: string): boolean {
    const pending = this.pendingRequests.get(id);
    if (!pending) return false;

    clearTimeout(pending.timeout);
    this.pendingRequests.delete(id);
    pending.reject(new Error(error));
    return true;
  }

  /**
   * Cleans up all pending requests (e.g. on process termination).
   */
  public cleanup(reason: string = "Sandbox terminated"): void {
    for (const [id, pending] of this.pendingRequests.entries()) {
      clearTimeout(pending.timeout);
      pending.reject(new Error(`${reason} (ID: ${id})`));
    }
    this.pendingRequests.clear();
  }
}

