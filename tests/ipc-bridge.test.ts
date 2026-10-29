import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { IpcBridge } from "../src/sandbox/ipc-bridge.ts";

describe("IpcBridge", () => {
  it("correlates requests with results correctly", async () => {
    const bridge = new IpcBridge();
    const id = bridge.generateId();

    const promise = new Promise((resolve, reject) => {
      bridge.registerPending(id, resolve, reject, 2000);
    });

    const handled = bridge.handleResult(id, { success: true, data: [1, 2, 3] });
    assert.strictEqual(handled, true);

    const result: any = await promise;
    assert.strictEqual(result.success, true);
    assert.deepStrictEqual(result.data, [1, 2, 3]);
  });

  it("handles tool errors properly", async () => {
    const bridge = new IpcBridge();
    const id = bridge.generateId();

    const promise = new Promise((resolve, reject) => {
      bridge.registerPending(id, resolve, reject, 2000);
    });

    bridge.handleError(id, "Unauthorized database access");

    await assert.rejects(promise, {
      message: "Unauthorized database access",
    });
  });

  it("times out pending requests if unfulfilled", async () => {
    const bridge = new IpcBridge();
    const id = bridge.generateId();

    const promise = new Promise((resolve, reject) => {
      bridge.registerPending(id, resolve, reject, 50); // 50ms short timeout
    });

    await assert.rejects(promise, /timed out after 50ms/);
  });
});

