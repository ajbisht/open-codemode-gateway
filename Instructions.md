# OpenCodeMode: Developer & Architectural Instructions

## Overview
**OpenCodeMode** is an open-source, vendor-agnostic implementation of the "Code Mode" Model Context Protocol (MCP) pattern. It bridges the gap between large enterprise APIs / MCP servers and LLM context window constraints.

Instead of exposing dozens or thousands of individual tools to an LLM (which floods the context window with raw schemas and intermediate JSON responses), OpenCodeMode exposes a single execution surface: `execute_code`.

Downstream MCP tools are transformed into a compact TypeScript declaration file (`.d.ts`). The LLM writes concise async TypeScript/JavaScript snippets that execute in a secure, isolated sandbox (Deno subprocess or Node.js worker). Intermediate payloads stay in sandbox memory; only the final return value or formatted result enters the LLM's context window.

---

## Architecture

![OpenCodeMode Solution Architecture](docs/architecture.jpg)

```
+-------------------------------------------------------------------+
|                            LLM AGENT                              |
|       (Claude Desktop / Cursor / Antigravity / Custom Agent)      |
+---------------------------------+---------------------------------+
                                  |
               Calls: execute_code(code: string)
                                  v
+-------------------------------------------------------------------+
|                       OPEN-CODE-MODE SERVER                       |
|                                                                   |
|   1. Downstream Adapter: Connects to target MCP (stdio or SSE)    |
|   2. Type Generator: Compiles JSON Schema -> TypeScript (.d.ts)   |
|   3. Sandbox Manager: Spawns isolated Deno subprocess             |
|   4. IPC RPC Bridge: Routes sandbox calls back to target tools    |
+---------------------------------+---------------------------------+
                                  |
                IPC stdio bridge  |  tools/call
                                  v
+---------------------------------+---------------------------------+
|                       DENO SANDBOX WORKER                         |
|   Flags: --no-net --no-read --no-write --no-env                   |
|   Memory cap: 128 MB | Timeout watchdog: 15s hard cutoff          |
|   Injected Global: `mcp` (Proxy routing calls via IPC)            |
+-------------------------------------------------------------------+
```

---

## Security Model & Threat Mitigations

| Threat Vector | Mitigation |
| :--- | :--- |
| **Sandbox Breakout** | Process-level isolation via Deno with strict permission flags. |
| **Network Exfiltration** | Subprocess executed with `--no-net`. The script cannot create network connections or call `fetch()`. |
| **Filesystem Tampering** | Subprocess executed with `--no-read` and `--no-write`. The script cannot read or alter files on disk. |
| **Infinite Loops (DoS)** | Hard timeout watchdog via `AbortController` (defaults to 15s). Terminating the child process on timeout. |
| **Memory Exhaustion (OOM)** | Subprocess constrained with `--v8-flags=--max-old-space-size=128`. |
| **Credential Leakage** | Child process launched with `--no-env`. Upstream secrets remain inside the host Node.js process. |

---

## Directory Structure

```
MCP_CODEMODE/
├── Instructions.md                 # System instructions & developer guide
├── Skills.md                       # Agent skill for writing code against OpenCodeMode
├── Agents.md                       # Multi-agent pair programming protocols
├── codemode.config.json            # Configuration file for downstream MCP servers (spokes)
├── codemode.config.example.json    # Full enterprise example config (Jira, GitHub, AWS, etc.)
├── package.json                    # Project metadata, dependencies, scripts
├── tsconfig.json                   # TypeScript compiler configuration (ESM/NodeNext)
├── src/
│   ├── index.ts                    # Library exports
│   ├── cli.ts                      # CLI entry point (supports --config, --init, --wrap)
│   ├── config.ts                   # Configuration loader & environment variable resolution
│   ├── types.ts                    # Shared protocol and configuration types
│   ├── adapter/
│   │   ├── downstream-client.ts    # Single downstream MCP client (stdio)
│   │   ├── multi-downstream-client.ts # Multi-spoke downstream hub and tool router
│   │   └── type-generator.ts       # JSON Schema to TypeScript .d.ts compiler (namespaced)
│   ├── sandbox/
│   │   ├── deno-executor.ts        # Deno subprocess launcher & watchdog
│   │   ├── worker-executor.ts      # Node.js worker fallback executor
│   │   ├── ipc-bridge.ts           # JSON-RPC line-delimited communication
│   │   ├── harness-code.ts         # Injected runner script with recursive proxy
│   │   └── index.ts                # Sandbox factory
│   └── server/
│       └── codemode-server.ts      # Upstream MCP server (exposes execute_code, get_tool_types)
└── tests/
    ├── type-generator.test.ts      # Type compiler tests
    ├── sandbox-security.test.ts    # Security & boundary attack tests
    ├── ipc-bridge.test.ts          # IPC communication tests
    ├── integration.test.ts         # Full end-to-end execution loop test
    └── multi-spoke.test.ts         # Multi-spoke config, routing, and orchestration tests
```

---

## Development & Testing Commands

```bash
# Install dependencies
npm install

# Run all unit and integration tests
npm test

# Run security regression tests specifically
npm run test:security

# Run the head-to-head performance & token benchmark
npm run benchmark

# Build the TypeScript project
npm run build

# Run dependency vulnerability audit
npm audit
```

---

## Live Client Integration (Claude Desktop / Cursor)

To test OpenCodeMode interactively with Claude Desktop or Cursor:

```json
{
  "mcpServers": {
    "open-codemode-demo": {
      "command": "node",
      "args": [
        "/path/to/open-codemode/dist/cli.js",
        "--wrap",
        "node /path/to/open-codemode/demo/demo-server.ts"
      ]
    }
  }
}
```

