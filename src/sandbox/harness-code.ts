/**
 * Generates the worker bootstrap code executed inside the isolated worker thread.
 */
export function generateWorkerCode(userCode: string): string {
  return `
import { parentPort } from "node:worker_threads";

const pendingResponses = new Map();
let reqIdCounter = 0;

// Capture console.log
console.log = (...args) => {
  parentPort.postMessage({
    type: "CONSOLE_LOG",
    payload: args.map(a => typeof a === "object" ? JSON.stringify(a) : String(a)).join(" ")
  });
};

// Listen for tool results from host
parentPort.on("message", (msg) => {
  if (msg.type === "TOOL_RESULT" || msg.type === "TOOL_ERROR") {
    const pending = pendingResponses.get(msg.id);
    if (pending) {
      pendingResponses.delete(msg.id);
      if (msg.type === "TOOL_RESULT") {
        pending.resolve(msg.payload);
      } else {
        pending.reject(new Error(msg.payload || "Tool execution failed"));
      }
    }
  }
});

// Chainable proxy supporting flat (mcp.tool()) and namespaced (mcp.spoke.tool()) calls
function createMcpProxy(segments = []) {
  const invoke = (args = {}) => {
    return new Promise((resolve, reject) => {
      const id = "worker_call_" + Date.now() + "_" + (++reqIdCounter);
      pendingResponses.set(id, { resolve, reject });

      parentPort.postMessage({
        type: "CALL_TOOL",
        id: id,
        payload: {
          tool: segments.join("."),
          path: segments,
          arguments: args
        }
      });
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

async function run() {
  try {
    // Execute user code
    // User code can be an async function, an expression, or a block of statements
    const wrappedCode = ${JSON.stringify(userCode)};
    const executor = new Function("mcp", "console", \`
      return (async () => {
        \${wrappedCode}
      })();
    \`);

    const result = await executor(mcp, console);

    parentPort.postMessage({
      type: "EXECUTION_COMPLETE",
      payload: result !== undefined ? result : null
    });
  } catch (err) {
    parentPort.postMessage({
      type: "EXECUTION_ERROR",
      payload: err instanceof Error ? err.message : String(err)
    });
  }
}

run();
`;
}
