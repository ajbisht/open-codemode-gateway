#!/usr/bin/env node
import * as fs from "node:fs";
import * as path from "node:path";
import { DownstreamClient } from "./adapter/downstream-client.ts";
import { MultiDownstreamClient } from "./adapter/multi-downstream-client.ts";
import { CodeModeServer } from "./server/codemode-server.ts";
import { loadConfigFile, generateStarterConfig } from "./config.ts";
import type { IDownstreamClient } from "./types.ts";

function printHelp() {
  console.error(`
OpenCodeMode CLI - Wraps any MCP servers with Code Mode sandbox execution

Usage:
  open-codemode [options]

Modes:
  1. Config File Mode (Multi-Spoke Hub):
     open-codemode                           # Auto-loads codemode.config.json in cwd
     open-codemode --config <path>           # Loads specified config file
     open-codemode --init                    # Generates starter codemode.config.json

  2. Wrap Mode (Single Server):
     open-codemode --wrap "<command> [args...]"

Options:
  --config, -f     Path to codemode.config.json file
  --init           Generate starter codemode.config.json in current directory
  --wrap, -w       Full command string of a single downstream MCP server to wrap
  --cmd, -c        Command executable of downstream MCP server
  --args, -a       Arguments to pass to downstream MCP server
  --timeout, -t    Sandbox execution timeout in milliseconds (default: 15000)
  --help, -h       Display this help message

Examples:
  open-codemode --init
  open-codemode --config ./codemode.config.json
  open-codemode --wrap "npx -y @modelcontextprotocol/server-postgres postgresql://..."
  open-codemode --wrap "python -m my_mcp_server"
`);
}

async function main() {
  const argv = process.argv.slice(2);

  if (argv.includes("--help") || argv.includes("-h")) {
    printHelp();
    process.exit(0);
  }

  // Handle --init
  if (argv.includes("--init")) {
    const targetFile = path.resolve(process.cwd(), "codemode.config.json");
    if (fs.existsSync(targetFile)) {
      console.error(`[OpenCodeMode] File already exists: ${targetFile}`);
      process.exit(1);
    }
    fs.writeFileSync(targetFile, generateStarterConfig(), "utf-8");
    console.error(`[OpenCodeMode] Created starter configuration at: ${targetFile}`);
    console.error(`Edit this file to add your MCP servers (Jira, GitHub, Postgres, AWS, etc.) and run 'open-codemode'.`);
    process.exit(0);
  }

  let command = "";
  let args: string[] = [];
  let timeoutMs: number | undefined;
  let configPath: string | undefined;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--config" || arg === "-f") {
      configPath = argv[++i];
    } else if (arg === "--wrap" || arg === "-w") {
      const wrapCmd = argv[++i];
      if (!wrapCmd) {
        console.error("Error: --wrap requires a command string");
        process.exit(1);
      }
      const parts = wrapCmd.match(/(?:[^\s"]+|"[^"]*")+/g) || [];
      const cleanParts = parts.map((p) => p.replace(/^"|"$/g, ""));
      command = cleanParts[0] || "";
      args = cleanParts.slice(1);
    } else if (arg === "--cmd" || arg === "-c") {
      command = argv[++i] || "";
    } else if (arg === "--args" || arg === "-a") {
      const remainingArgs = argv.slice(i + 1);
      const collected: string[] = [];
      for (const a of remainingArgs) {
        if (a.startsWith("-")) break;
        collected.push(a);
        i++;
      }
      args = collected;
    } else if (arg === "--timeout" || arg === "-t") {
      const val = parseInt(argv[++i], 10);
      if (!isNaN(val)) timeoutMs = val;
    }
  }

  let downstream: IDownstreamClient;

  if (command) {
    // Single server wrap mode
    downstream = new DownstreamClient({ command, args });
  } else {
    // Config file mode
    try {
      const loaded = await loadConfigFile(configPath);
      if (!loaded) {
        console.error(`[OpenCodeMode] No configuration file found.`);
        console.error(`To get started:`);
        console.error(`  1. Run 'open-codemode --init' to generate a starter codemode.config.json`);
        console.error(`  2. Or specify a config file: 'open-codemode --config path/to/config.json'`);
        console.error(`  3. Or wrap a single server: 'open-codemode --wrap "<command>"'`);
        process.exit(1);
      }

      const { config, filePath } = loaded;
      console.error(`[OpenCodeMode] Loaded configuration from: ${filePath}`);

      if (config.executionOptions?.timeoutMs && timeoutMs === undefined) {
        timeoutMs = config.executionOptions.timeoutMs;
      }

      downstream = new MultiDownstreamClient(config.mcpServers);
    } catch (err: any) {
      console.error(`[OpenCodeMode] Configuration error: ${err.message}`);
      process.exit(1);
    }
  }

  try {
    console.error(`[OpenCodeMode] Connecting to downstream MCP server(s)...`);
    await downstream.connect();

    const tools = downstream.getTools();
    console.error(`[OpenCodeMode] Successfully connected. Exposed ${tools.length} tool(s) in Code Mode.`);

    const codeModeServer = new CodeModeServer({
      downstreamClient: downstream,
      executionOptions: { timeoutMs: timeoutMs || 15000 },
    });

    await codeModeServer.start();
    console.error(`[OpenCodeMode] Code Mode MCP Server running on stdio.`);

    const cleanup = async () => {
      console.error(`[OpenCodeMode] Shutting down...`);
      await codeModeServer.stop();
      process.exit(0);
    };

    process.on("SIGINT", cleanup);
    process.on("SIGTERM", cleanup);
  } catch (err: any) {
    console.error(`[OpenCodeMode] Initialization failed: ${err.message}`);
    process.exit(1);
  }
}

main();
