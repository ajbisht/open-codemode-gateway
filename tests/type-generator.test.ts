import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { TypeGenerator } from "../src/adapter/type-generator.ts";
import type { McpToolDefinition } from "../src/types.ts";

describe("TypeGenerator", () => {
  it("generates simple string, number, and boolean types", () => {
    const tool: McpToolDefinition = {
      name: "calculate_tax",
      description: "Calculates tax based on income and residency",
      inputSchema: {
        type: "object",
        properties: {
          income: { type: "number", description: "Annual income in USD" },
          isResident: { type: "boolean" },
          state: { type: "string", enum: ["CA", "NY", "TX"] },
        },
        required: ["income", "isResident"],
      },
    };

    const declaration = TypeGenerator.generateFunctionDeclaration(tool);
    assert.ok(declaration.includes("function calculate_tax"));
    assert.ok(declaration.includes("income: number;"));
    assert.ok(declaration.includes("isResident: boolean;"));
    assert.ok(declaration.includes('state?: "CA" | "NY" | "TX";'));
    assert.ok(declaration.includes("Annual income in USD"));
  });

  it("handles arrays and nested objects", () => {
    const tool: McpToolDefinition = {
      name: "bulk_insert",
      inputSchema: {
        type: "object",
        properties: {
          items: {
            type: "array",
            items: {
              type: "object",
              properties: {
                id: { type: "string" },
                tags: { type: "array", items: { type: "string" } },
              },
              required: ["id"],
            },
          },
        },
        required: ["items"],
      },
    };

    const declaration = TypeGenerator.generateFunctionDeclaration(tool);
    assert.ok(declaration.includes("function bulk_insert"));
    assert.ok(declaration.includes("Array<{"));
    assert.ok(declaration.includes("id: string;"));
    assert.ok(declaration.includes("tags?: Array<string>;"));
  });

  it("generates complete namespace correctly", () => {
    const tools: McpToolDefinition[] = [
      {
        name: "list_users",
        description: "List all users",
        inputSchema: { type: "object", properties: {} },
      },
      {
        name: "get_user",
        description: "Get user by ID",
        inputSchema: {
          type: "object",
          properties: { id: { type: "string" } },
          required: ["id"],
        },
      },
    ];

    const namespace = TypeGenerator.generateNamespace(tools);
    assert.ok(namespace.includes("declare namespace mcp {"));
    assert.ok(namespace.includes("function list_users(args?: Record<string, any>): Promise<any>;"));
    assert.ok(namespace.includes("function get_user(args: {"));
    assert.ok(namespace.includes("id: string;"));
  });
});
