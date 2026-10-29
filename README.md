# OpenCodeMode (MCP)

<p align="center">
  <img src="architecture.jpg" alt="OpenCodeMode Solution Architecture" width="100%" />
</p>

<p align="center">
  <strong>Execute, filter, and orchestrate Model Context Protocol (MCP) tools inside an isolated, token-efficient sandbox in a single LLM turn.</strong>
</p>

<p align="center">
  <a href="#the-problem-why-traditional-mcp-breaks-at-scale"><img src="https://img.shields.io/badge/Context%20Window%20Saved-86.1%25-brightgreen" alt="Tokens Saved" /></a>
  <a href="#performance--token-benchmark"><img src="https://img.shields.io/badge/Latency-6.8x%20Faster-blue" alt="Latency" /></a>
  <a href="#performance--token-benchmark"><img src="https://img.shields.io/badge/Inference%20Turns-1%20vs%207-orange" alt="Turns" /></a>
  <a href="#security-model--sandboxing"><img src="https://img.shields.io/badge/Sandbox-Deno%20%7C%20Node%20Worker-purple" alt="Sandboxes" /></a>
  <a href="#running-benchmarks--automated-tests"><img src="https://img.shields.io/badge/Vulnerabilities-0%20(npm%20audit)-success" alt="Audit" /></a>
  <a href="#license"><img src="https://img.shields.io/badge/License-MIT-green.svg" alt="License" /></a>
</p>

---

## Table of Contents

- [Overview](#overview)
- [The Problem: Why Traditional MCP Breaks at Scale](#the-problem-why-traditional-mcp-breaks-at-scale)
- [The Solution: OpenCodeMode Architecture](#the-solution-opencodemode-architecture)
- [End-to-End Request Flow](#end-to-end-request-flow)
- [Cloudflare Code Mode vs. OpenCodeMode](#cloudflare-code-mode-vs-opencode-mode-what-we-changed)
- [Performance & Token Benchmark](#performance--token-benchmark)
- [Installation & Quickstart](#installation--quickstart)
- [Configuration: Connecting Your MCP Servers](#configuration-connecting-your-mcp-servers)
  - [Mode 1: Multi-Spoke Hub (`codemode.config.json`)](#mode-1-multi-spoke-hub-codemodeconfigjson)
  - [Mode 2: Instant Single-Server Wrapper (`--wrap`)](#mode-2-instant-single-server-wrapper---wrap)
  - [Mode 3: Embedded TypeScript Library](#mode-3-embedded-typescript-library)
- [How the LLM Orchestrates Tools in 1 Turn](#how-the-llm-orchestrates-tools-in-1-turn)
- [How to Connect to Any IDE or Agent](#how-to-connect-to-any-ide-or-agent)
  - [1. Claude Desktop](#1-claude-desktop)
  - [2. Cursor & Windsurf](#2-cursor--windsurf)
  - [3. Google Antigravity & Gemini CLI](#3-google-antigravity--gemini-cli)
  - [4. VS Code (Cline / Roo Code)](#4-vs-code-cline--roo-code)
  - [5. Custom Multi-Agent Frameworks (LangGraph, CrewAI, AutoGen)](#5-custom-multi-agent-frameworks-langgraph-crewai-autogen)
- [Security Model & Sandboxing](#security-model--sandboxing)
- [Running Benchmarks & Automated Tests](#running-benchmarks--automated-tests)
- [License](#license)

---

## Overview

**OpenCodeMode** is an open-source, vendor-agnostic implementation of the **Code Mode** pattern for the Model Context Protocol (MCP).

Instead of forcing your AI Agent to execute individual JSON-RPC tool calls across multiple round-trips—flooding the context window with raw schemas and bloated intermediate responses—OpenCodeMode collapses all downstream tools into **one single tool (`execute_code`)**.

The agent writes a concise TypeScript snippet against generated `.d.ts` definitions. That code executes inside a hardened, isolated sandbox (Deno or Node.js Worker), joins and filters data **in memory**, and returns only the final answer to the LLM in **1 single turn**.

> **Deploy Anywhere:** Designed for any platform—**Cloud (AWS, GCP, Azure), On-Premises, Hybrid, Kubernetes, Docker, or local machines**.

---

## The Problem: Why Traditional MCP Breaks at Scale

When connecting enterprise agents to modern hubs (Jira, ServiceNow, GitHub, AWS, Postgres, Jenkins, etc.), standard MCP architectures hit three massive bottlenecks:

```
TRADITIONAL MCP: 7 TURNS, 4,344 TOKENS, 12.6 SECONDS
LLM  <-- (350 tokens of JSON schemas) -----------------------------> Agent
Turn 1: LLM calls db.list_users()     --> 100 raw JSON records (3,900 tokens) enters context!
Turn 2: LLM calls jira.get_issue(#1)  --> raw issue payload enters context
Turn 3: LLM calls jira.get_issue(#2)  --> raw issue payload enters context
...
Turn 7: LLM finally returns answer    --> 12.6s elapsed, context bloated, high API cost!
```

1. **Schema Context Exhaustion:** Dumps dozens or hundreds of JSON schemas into the system prompt on *every request* (costing **40,000 to 100,000+ tokens** before the user even types a word).
2. **Intermediate Data Pollution:** In multi-step workflows, large intermediate payloads (e.g. 5 MB build logs, 500-row SQL dumps, raw API JSON) are echoed back and forth through the model context.
3. **Turn-by-Turn Latency:** 10 tool calls require **10 back-and-forth LLM inference round-trips** (~30 to 60 seconds).
4. **Tool Call Limit Crashing:** LLMs routinely hit maximum step limits (e.g., 25–50 iterations) when doing repetitive loops or bulk processing.

---

## The Solution: OpenCodeMode Architecture

OpenCodeMode sits as an intelligent gateway layer between the AI Agent and your MCP servers:

```
OPENCODEMODE: 1 TURN, 602 TOKENS, 1.8 SECONDS
LLM  <-- (250 tokens of compact .d.ts types) ------------------------> Agent
Turn 1: LLM writes ONE TypeScript script:
        "const users = await mcp.postgres.list_users();
         const target = users.filter(u => u.rating >= 4.7);
         for (const u of target) await mcp.bonus.award({ id: u.id });
         return target.map(u => u.name);"
               │
               ▼ (Executes locally in secure Sandbox in 40ms)
        Sandboxed RAM filters 100 records in memory.
        Downstream tools called via fast local IPC.
               │
               ▼
LLM  <-- Returns clean 3-line result array --------------------------> Done in 1 Turn!
```

---

## End-to-End Request Flow

As shown in the architecture diagram, the lifecycle of a user request proceeds through these 15 steps:

```
[Developer/User] ──(1) Natural Language──► [Customer App / IDE]
                                                    │
                                         (2) HTTPS Request (AuthN/Rate Limit)
                                                    ▼
                                          [customer-api Gateway]
                                                    │
                                         (3) Forward Context & Task
                                                    ▼
                                         [coordinator-agent]
                                           │              │
                   (4) Request Plan / Code │              │ (6) Optional Specialist
                                           ▼              ▼     Agents (worklist, policy)
                                     [External LLM]       │ (7) Return Results
                                           │              │
                   (5) Plan / Code Script  │              ▼
                                           ▼     (8) Calls execute_code()
                                         [OPEN-CODE-MODE GATEWAY]
                                           │  ├── 1. Single Tool: execute_code()
                                           │  ├── 2. Isolated Sandbox (No Net/No ENV)
                                           │  └── 3. Routing & Tool Bridge
                                           │
                                         (9) Routes to Downstream Servers
                                           ▼
                    ┌──────────────────────┬──────────────────────┐
                    ▼                      ▼                      ▼
           [mcp-worklist-server]    [mcp-hr-server]       [mcp-email-server]
                    │                      │                      │
             (10) API Calls         (10) API Calls         (10) API Calls
                    ▼                      ▼                      ▼
             [Git / Worklist]        [HR System]            [Email System]
                    │                      │                      │
             (11) Raw Results Trapped in Sandbox RAM (Only Filtered Summary Returns)
                    │
                    ▼
          [coordinator-agent] ──(12) Final LLM Call──► [External LLM]
                    │                                         │
                    │ ◄───────────(13) Final Answer───────────┘
                    │
          (14) Stream Final Response
                    ▼
          [customer-api] ──(15) Stream Response to User──► [Developer / IDE]
```

1. **User asks coding task:** Request originates from Web UI, IDE, or chat app.
2. **HTTPS Request:** Passes through `customer-api` for authentication, rate limiting, and trace generation.
3. **Forward Context:** API sends user prompt and workspace context to the `coordinator-agent`.
4. **Request Plan / Code:** Coordinator calls the External LLM (Claude, GPT, Gemini).
5. **LLM Returns Script:** The LLM inspects compact `.d.ts` declarations and writes a single TypeScript orchestration snippet.
6. **Optional Specialist Agents:** If needed, coordinator queries domain specialist agents (worklist, policy, notification).
7. **Specialists Return Results:** Context is consolidated at the coordinator.
8. **Calls `execute_code`:** Coordinator invokes OpenCodeMode's `execute_code` tool with the snippet.
9. **Spoke Routing:** OpenCodeMode's IPC bridge routes tool calls to target MCP servers (Worklist, HR, Email).
10. **Downstream Execution:** MCP servers invoke external enterprise APIs and databases.
11. **In-Memory Filtering:** Thousands of raw JSON records are processed in sandbox RAM; **only filtered results return**.
12. **Coordinator Calls LLM for Synthesis:** Sends filtered observations to LLM for final formatting.
13. **Final Answer:** External LLM returns concise answer.
14. **Coordinator Streams Response:** Formatted output sent back to `customer-api`.
15. **Delivery:** Result streamed back to developer in **1 single conversational turn**.

---

## Cloudflare Code Mode vs. OpenCodeMode: What We Changed

The pioneering idea of "Code Mode" was published by [Cloudflare's AI team](https://blog.cloudflare.com/code-mode/) and [Cloudflare Agents](https://github.com/cloudflare/agents/blob/main/docs/codemode/index.md). 

While Cloudflare demonstrated the power of the concept, their implementation was designed specifically for Cloudflare's proprietary cloud ecosystem. **OpenCodeMode** is built from the ground up as a **universal, self-hosted, enterprise-grade open-source solution**:

| Feature / Dimension | Cloudflare Code Mode | OpenCodeMode (This Repo) |
| :--- | :--- | :--- |
| **Vendor Independence** | Locked to Cloudflare Workers & Cloudflare Workers AI. | **100% Vendor-Agnostic.** Runs on your laptop, Docker, Kubernetes, AWS, GCP, Azure, or bare metal. |
| **Runtime Requirements** | Requires Cloudflare account, wrangler, and dynamic code evaluation flags. | Runs on **Node.js (>=18)** with automatic **Deno** sandbox detection or **Node Worker Thread** fallback. |
| **Multi-Spoke Hub** | Primarily wraps tools known to the specific worker script. | **Multi-Spoke Hub (`codemode.config.json`):** Seamlessly wraps any arbitrary MCP servers (Jira, GitHub, ServiceNow, Postgres) with automatic namespacing (`mcp.jira.*`, `mcp.github.*`). |
| **Configuration Standard** | Custom code configuration. | **Industry-Standard `mcpServers` format** with automatic environment variable expansion (`${TOKEN}`). |
| **Zero-Config CLI** | N/A (Cloudflare Worker script). | Instant CLI with `--wrap "<cmd>"` or `--config <path>` to wrap any server in 5 seconds. |
| **Security Isolation** | Relies on Cloudflare V8 worker isolate runtime. | Multi-layer sandbox enforcement: Process-level `--no-net`, `--no-env`, `--no-read`, `--no-write`, 128MB RAM caps, and hard 15s watchdog timers. |
| **Client Compatibility** | Custom agent integration. | **Native MCP protocol compliance:** Works out-of-the-box with Claude Desktop, Cursor, Antigravity, VS Code, and any MCP client. |

---

## Performance & Token Benchmark

We conducted a verified, reproducible benchmark comparing Traditional MCP tool calling against OpenCodeMode executing an audit over 100 customer records and triggering automated fraud flagging:

| Metric | Traditional MCP | OpenCodeMode | Improvement |
| :--- | :--- | :--- | :--- |
| **Tool Schema Tokens** | 349 tokens | 255 tokens | **-26.9%** |
| **Intermediate Data in Context** | 3,943 tokens | **0 tokens** (processed in RAM) | **100% saved** |
| **Total Context Window Used** | 4,344 tokens | **602 tokens** | **-86.1% less tokens** |
| **Inference Turns (Round Trips)** | 7 turns | **1 turn** | **-86% fewer turns** |
| **End-to-End Latency** | ~12.6s | **~1.8s** | **6.8x FASTER** |
| **Sandbox Execution Time** | N/A | **46 ms** | Sub-millisecond local IPC |

> To run this benchmark live on your machine:
> ```bash
> npm run benchmark
> ```

---

## Installation & Quickstart

### Prerequisites
- **Node.js**: v18.0.0 or higher (v20+ or v24 recommended)
- **Optional (Recommended)**: [Deno](https://deno.land/) for OS-level subprocess sandboxing (OpenCodeMode automatically falls back to hardened Node Worker Threads if Deno is not installed).

### 1. Clone & Build
```bash
git clone https://github.com/your-org/open-codemode.git
cd open-codemode
npm install
npm run build
```

### 2. Verify Your Setup
```bash
# Run the 19 automated unit & integration test suites
npm test

# Run security sandbox regression attacks
npm run test:security
```

### 3. Docker Deployment (Optional)
You can also run OpenCodeMode as a hardened Docker container with bundled Deno sandbox isolation:

```bash
# Build the Docker image
docker build -t open-codemode-mcp .

# Run with your codemode.config.json mounted
docker run -i --rm -v $(pwd)/codemode.config.json:/app/codemode.config.json open-codemode-mcp
```

---

## Configuration: Connecting Your MCP Servers

OpenCodeMode works with **any MCP server**. You don't need to write code to connect your tools—just specify them using one of the three modes below.

### Mode 1: Multi-Spoke Hub (`codemode.config.json`)

Connect multiple MCP servers (Jira, GitHub, Postgres, AWS, ServiceNow) simultaneously into a unified sandbox.

Generate a starter configuration file:
```bash
node dist/cli.js --init
```

Or create `codemode.config.json` in your project root:

```json
{
  "$schema": "https://json.schemastore.org/mcp-config.json",
  "mcpServers": {
    "jira": {
      "command": "docker",
      "args": ["run", "-i", "--rm", "-e", "JIRA_API_TOKEN", "mcp/jira"],
      "env": {
        "JIRA_API_TOKEN": "${JIRA_API_TOKEN}"
      }
    },
    "github": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-github"],
      "env": {
        "GITHUB_PERSONAL_ACCESS_TOKEN": "${GITHUB_TOKEN}"
      }
    },
    "postgres": {
      "command": "npx",
      "args": [
        "-y",
        "@modelcontextprotocol/server-postgres",
        "postgresql://${DB_USER}:${DB_PASS}@localhost:5432/mydb"
      ]
    },
    "aws": {
      "command": "python",
      "args": ["-m", "mcp_server_aws"]
    }
  },
  "executionOptions": {
    "timeoutMs": 15000,
    "memoryLimitMb": 128
  }
}
```

Then run OpenCodeMode:
```bash
# Auto-loads codemode.config.json in the current working directory
node dist/cli.js

# Or specify a custom config file path
node dist/cli.js --config /path/to/my-config.json
```

> **Security Note:** Environment variables (like `${GITHUB_TOKEN}`) are expanded at runtime on the host machine. **No credentials are ever passed into the sandbox.**

---

### Mode 2: Instant Single-Server Wrapper (`--wrap`)

If you just want to wrap a single MCP server on the fly without creating a configuration file:

```bash
# Wrap a PostgreSQL MCP server
node dist/cli.js --wrap "npx -y @modelcontextprotocol/server-postgres postgresql://localhost/mydb"

# Wrap an in-memory MCP server
node dist/cli.js --wrap "npx -y @modelcontextprotocol/server-memory"

# Wrap a custom Python MCP server
node dist/cli.js --wrap "python -m my_mcp_server"
```

---

### Mode 3: Embedded TypeScript Library

You can import OpenCodeMode directly into your own TypeScript / JavaScript agent backend:

```typescript
import { CodeModeServer, DownstreamClient, MultiDownstreamClient } from "open-codemode";

// Connect to downstream spokes
const downstream = new MultiDownstreamClient({
  jira: { command: "docker", args: ["run", "-i", "--rm", "mcp/jira"] },
  github: { command: "npx", args: ["-y", "@modelcontextprotocol/server-github"] }
});
await downstream.connect();

// Create upstream Code Mode server
const server = new CodeModeServer({
  downstreamClient: downstream,
  executionOptions: { timeoutMs: 15000, memoryLimitMb: 128 }
});

await server.start();
```

---

## How the LLM Orchestrates Tools in 1 Turn

When the AI Agent connects to OpenCodeMode, it receives a single tool: **`execute_code`**.
All tools from your configured servers are automatically compiled into clean TypeScript namespaces:

```typescript
declare namespace mcp {
  namespace jira {
    /** Search Jira tickets with JQL */
    function search_issues(args: { jql: string }): Promise<any>;
    /** Update issue status */
    function update_issue(args: { id: string; status: string }): Promise<any>;
  }

  namespace github {
    /** Get pull request details */
    function get_pr(args: { prNumber: number }): Promise<any>;
  }

  namespace postgres {
    /** Execute SQL query */
    function query(args: { sql: string }): Promise<any>;
  }
}
```

The LLM writes standard async TypeScript to orchestrate across spokes:

```typescript
// Script written by the LLM:
const openTickets = await mcp.jira.search_issues({ jql: "status = 'Review' AND priority = 'High'" });

const results = [];
for (const ticket of openTickets) {
  // Query downstream GitHub spoke
  const pr = await mcp.github.get_pr({ prNumber: ticket.pr_id });
  
  // In-memory logic: only act if PR is approved and merged
  if (pr.merged) {
    await mcp.jira.update_issue({ id: ticket.id, status: "Done" });
    results.push({ ticket: ticket.key, title: ticket.summary, pr: pr.title });
  }
}

// Return only the clean, final report
return results;
```

---

## How to Connect to Any IDE or Agent

OpenCodeMode runs as a standard MCP server communicating over `stdio`. It can be added to any MCP-compliant tool or agent in seconds.

### 1. Claude Desktop
Add to your `claude_desktop_config.json`:
- **macOS:** `~/Library/Application Support/Claude/claude_desktop_config.json`
- **Windows:** `%APPDATA%\Claude\claude_desktop_config.json`

```json
{
  "mcpServers": {
    "opencode-hub": {
      "command": "node",
      "args": [
        "C:/path/to/open-codemode/dist/cli.js",
        "--config",
        "C:/path/to/open-codemode/codemode.config.json"
      ]
    }
  }
}
```

---

### 2. Cursor & Windsurf
Add to `.cursor/mcp.json` in your workspace or global settings:

```json
{
  "mcpServers": {
    "opencode-hub": {
      "command": "node",
      "args": [
        "/path/to/open-codemode/dist/cli.js",
        "--config",
        "/path/to/open-codemode/codemode.config.json"
      ]
    }
  }
}
```

---

### 3. Google Antigravity & Gemini CLI
Add to `mcp_config.json`:

```json
{
  "mcpServers": {
    "open-codemode": {
      "command": "node",
      "args": [
        "/path/to/open-codemode/dist/cli.js",
        "--config",
        "/path/to/open-codemode/codemode.config.json"
      ]
    }
  }
}
```

---

### 4. VS Code (Cline / Roo Code)
In your Cline / Roo Code MCP Settings:
```json
{
  "mcpServers": {
    "opencode": {
      "command": "node",
      "args": [
        "/path/to/open-codemode/dist/cli.js",
        "--config",
        "/path/to/open-codemode/codemode.config.json"
      ]
    }
  }
}
```

---

### 5. Custom Multi-Agent Frameworks (LangGraph, CrewAI, AutoGen)
Connect any agent worker via stdio or import OpenCodeMode as a Node.js library directly into your agent runner:

```python
# Python LangGraph / CrewAI example invoking OpenCodeMode CLI over stdio:
from mcp import ClientSession, StdioServerParameters
from mcp.client.stdio import stdio_client

server_params = StdioServerParameters(
    command="node",
    args=["/path/to/open-codemode/dist/cli.js", "--config", "/path/to/codemode.config.json"]
)
```

---

## Security Model & Sandboxing

Because OpenCodeMode executes LLM-generated code, security and isolation are primary engineering requirements.

```
+-------------------------------------------------------------+
| HOST PROCESS (Node.js)                                      |
| * Stores API keys, database credentials, host tokens        |
| * Speaks to upstream Agent and downstream MCP servers       |
| * Validates & sanitizes all IPC messages                    |
+------------------------------+------------------------------+
                               | IPC Channel (Line JSON-RPC)
                               v
+-------------------------------------------------------------+
| HARDENED SANDBOX (Deno / Worker)                            |
| 🔒 NO NETWORK:      --no-net (cannot make outbound fetch)   |
| 🔒 NO FILESYSTEM:   --no-read --no-write (cannot read disk) |
| 🔒 NO ENV SECRETS:  --no-env (cannot read process.env)      |
| 🔒 MEMORY CEILING:  128 MB max V8 heap space                |
| 🔒 HARD WATCHDOG:   15,000 ms kill timer terminates hangs   |
+-------------------------------------------------------------+
```

| Threat Vector | Mitigation Strategy |
| :--- | :--- |
| **Sandbox Breakout** | Process-level isolation via Deno or dedicated Worker threads with empty prototypes. |
| **Data Exfiltration** | Sandbox launched with `--no-net`. Network sockets and `fetch` calls are blocked. |
| **Filesystem Tampering** | Sandbox launched with `--no-read` and `--no-write`. Host disk cannot be inspected. |
| **Credential Theft** | Sandbox launched with empty `env: {}`. Host credentials never enter sandbox memory. |
| **Denial of Service (Infinite Loops)** | Hard 15-second watchdog timer terminates and reaps child processes that exceed runtime limits. |
| **Memory Exhaustion (OOM)** | Hard V8 old space ceiling (`--v8-flags=--max-old-space-size=128`). |

---

## Running Benchmarks & Automated Tests

OpenCodeMode enforces strict testing standards:

```bash
# 1. Run all unit & integration test suites
npm test

# 2. Run security boundary & attack tests
npm run test:security

# 3. Run the head-to-head performance benchmark
npm run benchmark

# 4. Run vulnerability scan (Guaranteed 0 CVEs)
npm audit
```

### Test Suite Summary:
```
▶ OpenCodeMode End-to-End Integration (2 tests)
▶ IpcBridge (3 tests)
▶ Multi-Spoke Configuration & Loading (2 tests)
▶ Multi-Spoke Type Generator (1 test)
▶ MultiDownstreamClient & Sandbox Execution (2 tests)
▶ Sandbox Security & Execution Tests (6 tests)
▶ TypeGenerator (3 tests)

✔ 19 tests passed, 0 failed (1.8s)
✔ 0 vulnerabilities found
```

---

## License

This project is licensed under the [MIT License](LICENSE).
Feel free to use it in your commercial or open-source AI agent applications.
