import type { McpToolDefinition, McpToolParameterSchema } from "../types.ts";

/**
 * Compiles MCP tool definitions and their JSON Schemas into compact,
 * token-efficient TypeScript type declarations (.d.ts).
 */
export class TypeGenerator {
  /**
   * Generates a complete `declare namespace mcp { ... }` block
   * for an array of MCP tools. If tools belong to different spokes (servers),
   * nested namespaces are generated (e.g. `mcp.github.create_issue(...)`).
   */
  public static generateNamespace(tools: McpToolDefinition[]): string {
    const lines: string[] = [
      "/**",
      " * OpenCodeMode Injected API",
      " * Every function executes through the secure IPC bridge to the downstream MCP server.",
      " * Intermediate data stays inside sandbox memory; return only the desired result.",
      " */",
      "declare namespace mcp {",
    ];

    const hasSpokes = tools.some((t) => !!t.spoke);

    if (!hasSpokes) {
      // Flat single-server mode
      for (const tool of tools) {
        lines.push(this.generateFunctionDeclaration(tool, 1));
      }
    } else {
      // Group by spoke
      const rootTools: McpToolDefinition[] = [];
      const spokeMap = new Map<string, McpToolDefinition[]>();

      for (const tool of tools) {
        if (!tool.spoke) {
          rootTools.push(tool);
        } else {
          const list = spokeMap.get(tool.spoke) || [];
          list.push(tool);
          spokeMap.set(tool.spoke, list);
        }
      }

      // Output root tools first
      for (const tool of rootTools) {
        lines.push(this.generateFunctionDeclaration(tool, 1));
      }

      // Output spoke namespaces
      for (const [spoke, spokeTools] of spokeMap.entries()) {
        lines.push(`  namespace ${this.sanitizeIdentifier(spoke)} {`);
        for (const tool of spokeTools) {
          lines.push(this.generateFunctionDeclaration(tool, 2, spoke));
        }
        lines.push("  }");
      }
    }

    lines.push("}");
    return lines.join("\n");
  }

  /**
   * Generates a single function signature with JSDoc comments for a tool.
   */
  public static generateFunctionDeclaration(
    tool: McpToolDefinition,
    indentLevel: number = 1,
    stripPrefix?: string
  ): string {
    const lines: string[] = [];
    const indent = "  ".repeat(indentLevel);

    // JSDoc
    lines.push(`${indent}/**`);
    if (tool.description) {
      for (const descLine of tool.description.split("\n")) {
        lines.push(`${indent} * ${descLine}`);
      }
    }

    const schema = tool.inputSchema || {};
    const properties = schema.properties || {};
    const required = new Set(schema.required || []);

    for (const [propName, propSchema] of Object.entries(properties)) {
      const pDesc = (propSchema as any)?.description;
      if (pDesc) {
        lines.push(`${indent} * @param args.${propName} ${pDesc.replace(/\n/g, " ")}`);
      }
    }
    lines.push(`${indent} */`);

    // Determine function name
    let funcName = tool.name;
    if (stripPrefix && funcName.startsWith(`${stripPrefix}.`)) {
      funcName = funcName.slice(stripPrefix.length + 1);
    }

    // Function parameter type
    const paramType = this.schemaToTsType(schema, indentLevel + 1);
    const hasProps = Object.keys(properties).length > 0;

    if (!hasProps) {
      lines.push(`${indent}function ${this.sanitizeIdentifier(funcName)}(args?: Record<string, any>): Promise<any>;`);
    } else {
      const isOptional = required.size === 0;
      lines.push(
        `${indent}function ${this.sanitizeIdentifier(funcName)}(args${isOptional ? "?" : ""}: ${paramType}): Promise<any>;`
      );
    }

    return lines.join("\n");
  }

  /**
   * Recursively converts a JSON Schema node into a TypeScript type string.
   */
  public static schemaToTsType(schema: McpToolParameterSchema | undefined, indentLevel: number = 0): string {
    if (!schema) return "any";

    // Handle enums
    if (Array.isArray(schema.enum) && schema.enum.length > 0) {
      return schema.enum.map((val) => JSON.stringify(val)).join(" | ");
    }

    const type = schema.type;

    if (type === "string") {
      return "string";
    }

    if (type === "number" || type === "integer") {
      return "number";
    }

    if (type === "boolean") {
      return "boolean";
    }

    if (type === "array") {
      const itemType = schema.items
        ? this.schemaToTsType(schema.items, indentLevel)
        : "any";
      return `Array<${itemType}>`;
    }

    if (type === "object" || schema.properties) {
      const properties = schema.properties || {};
      const required = new Set(schema.required || []);
      const keys = Object.keys(properties);

      if (keys.length === 0) {
        return "Record<string, any>";
      }

      const indent = "  ".repeat(indentLevel);
      const innerIndent = "  ".repeat(indentLevel + 1);

      const fieldLines: string[] = [];
      for (const [propName, propSchema] of Object.entries(properties)) {
        const isRequired = required.has(propName);
        const fieldType = this.schemaToTsType(propSchema as McpToolParameterSchema, indentLevel + 1);
        const safeName = this.sanitizeIdentifier(propName);
        fieldLines.push(`${innerIndent}${safeName}${isRequired ? "" : "?"}: ${fieldType};`);
      }

      return `{\n${fieldLines.join("\n")}\n${indent}}`;
    }

    return "any";
  }

  /**
   * Sanitizes property or function names to be valid TypeScript identifiers.
   */
  private static sanitizeIdentifier(name: string): string {
    if (/^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(name)) {
      return name;
    }
    return JSON.stringify(name);
  }
}
