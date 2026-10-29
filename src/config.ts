import * as fs from "node:fs";
import * as path from "node:path";
import type { CodeModeConfigFile } from "./types.ts";

/**
 * Expands ${ENV_VAR} or $ENV_VAR inside a string using process.env
 */
export function expandEnvVars(value: string): string {
  return value.replace(/\$\{([A-Z0-9_]+)\}|\$([A-Z0-9_]+)/gi, (_, v1, v2) => {
    const varName = v1 || v2;
    return process.env[varName] !== undefined ? process.env[varName]! : "";
  });
}

/**
 * Recursively expands environment variables in objects, arrays, and strings
 */
export function expandConfigEnv(obj: any): any {
  if (typeof obj === "string") {
    return expandEnvVars(obj);
  }
  if (Array.isArray(obj)) {
    return obj.map(expandConfigEnv);
  }
  if (obj && typeof obj === "object") {
    const result: Record<string, any> = {};
    for (const [key, val] of Object.entries(obj)) {
      result[key] = expandConfigEnv(val);
    }
    return result;
  }
  return obj;
}

/**
 * Finds and loads a CodeMode configuration file.
 * If configPath is specified, reads from that path.
 * Otherwise checks for `codemode.config.json` or `codemode.json` in the current working directory.
 */
export async function loadConfigFile(configPath?: string): Promise<{ config: CodeModeConfigFile; filePath: string } | null> {
  const candidates: string[] = [];

  if (configPath) {
    const resolved = path.isAbsolute(configPath) ? configPath : path.resolve(process.cwd(), configPath);
    candidates.push(resolved);
  } else {
    candidates.push(
      path.resolve(process.cwd(), "codemode.config.json"),
      path.resolve(process.cwd(), "codemode.json")
    );
  }

  let foundPath: string | null = null;
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      foundPath = candidate;
      break;
    }
  }

  if (!foundPath) {
    if (configPath) {
      throw new Error(`Specified config file not found: ${configPath}`);
    }
    return null;
  }

  let rawContent: string;
  try {
    rawContent = fs.readFileSync(foundPath, "utf-8");
  } catch (err: any) {
    throw new Error(`Failed to read configuration file at ${foundPath}: ${err.message}`);
  }

  let parsed: any;
  try {
    parsed = JSON.parse(rawContent);
  } catch (err: any) {
    throw new Error(`Failed to parse configuration JSON in ${foundPath}: ${err.message}`);
  }

  if (!parsed || typeof parsed !== "object") {
    throw new Error(`Invalid configuration format in ${foundPath}: Expected JSON object`);
  }

  if (!parsed.mcpServers || typeof parsed.mcpServers !== "object") {
    throw new Error(`Invalid configuration format in ${foundPath}: Missing 'mcpServers' object`);
  }

  const expanded = expandConfigEnv(parsed) as CodeModeConfigFile;
  return { config: expanded, filePath: foundPath };
}

/**
 * Generates a starter codemode.config.json template.
 */
export function generateStarterConfig(): string {
  const starter = {
    "$schema": "https://json.schemastore.org/mcp-config.json",
    "mcpServers": {
      "github": {
        "command": "npx",
        "args": ["-y", "@modelcontextprotocol/server-github"],
        "env": {
          "GITHUB_PERSONAL_ACCESS_TOKEN": "${GITHUB_TOKEN}"
        }
      },
      "postgres": {
        "command": "npx",
        "args": ["-y", "@modelcontextprotocol/server-postgres", "postgresql://user:password@localhost:5432/mydb"]
      },
      "jira": {
        "command": "docker",
        "args": ["run", "-i", "--rm", "-e", "JIRA_API_TOKEN", "mcp/jira"],
        "env": {
          "JIRA_API_TOKEN": "${JIRA_TOKEN}"
        }
      }
    },
    "executionOptions": {
      "timeoutMs": 15000,
      "memoryLimitMb": 128
    }
  };

  return JSON.stringify(starter, null, 2);
}

