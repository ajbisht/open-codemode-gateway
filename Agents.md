# Agent Protocol: OpenCodeMode Architecture & Pair Programming

## Core Operating Principles

As an agent operating on the OpenCodeMode codebase, you must adhere strictly to these engineering standards:

### 1. Zero Untested Code
* Every feature, adapter, and sandbox executor must be accompanied by comprehensive unit and integration tests.
* Do not mark any task or feature as complete without verifying that `npm test` runs cleanly.

### 2. Mandatory Security & Vulnerability Audits
* Code execution involves untrusted inputs. All isolation mechanisms must be explicitly tested with adversarial payloads:
  - Unauthorized filesystem reads/writes.
  - Network egress attempts.
  - Environment variable access.
  - Infinite loop execution and resource exhaustion.
* Run `npm audit` on all dependencies to guarantee zero known CVEs.

### 3. Separation of Concerns
* **Host Layer (`src/server/`, `src/adapter/`):** Runs in Node.js. Holds all credentials, connects to downstream MCP servers, handles MCP protocol traffic. Never executes untrusted code directly.
* **Sandbox Layer (`src/sandbox/`):** Runs inside isolated Deno or restricted workers. Has zero access to host memory, environment variables, or disk. Communicates with host strictly via structured line-delimited JSON-RPC messages.
* **Bridge Layer (`src/sandbox/ipc-bridge.ts`):** Validates and sanitizes all messages flowing between the sandbox and the host.

### 4. Code Quality & Formatting
* Strict TypeScript mode (`noImplicitAny`, `strictNullChecks`).
* Clean idiomatic async/await error handling.
* Clean and readable comments explaining security boundaries.

