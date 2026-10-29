#!/usr/bin/env node
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

/**
 * A self-contained demo downstream MCP server for live testing with OpenCodeMode.
 */
interface Employee {
  id: string;
  name: string;
  department: string;
  salary: number;
  rating: number; // 1 to 5
}

const mockEmployees: Employee[] = [
  { id: "EMP-01", name: "Alice Johnson", department: "Engineering", salary: 145000, rating: 4.8 },
  { id: "EMP-02", name: "Bob Smith", department: "Engineering", salary: 110000, rating: 3.9 },
  { id: "EMP-03", name: "Charlie Davis", department: "Sales", salary: 95000, rating: 4.9 },
  { id: "EMP-04", name: "Diana Prince", department: "Engineering", salary: 160000, rating: 5.0 },
  { id: "EMP-05", name: "Evan Wright", department: "Marketing", salary: 88000, rating: 4.2 },
  { id: "EMP-06", name: "Fiona Gallagher", department: "Support", salary: 72000, rating: 4.6 },
  { id: "EMP-07", name: "George Clark", department: "Sales", salary: 105000, rating: 3.5 },
  { id: "EMP-08", name: "Hannah Abbott", department: "Engineering", salary: 135000, rating: 4.7 },
  { id: "EMP-09", name: "Ian Malcolm", department: "Product", salary: 140000, rating: 4.9 },
  { id: "EMP-10", name: "Julia Roberts", department: "Support", salary: 75000, rating: 3.8 },
];

const awardedBonuses: Array<{ employeeId: string; amount: number }> = [];

const server = new Server(
  { name: "demo-company-db", version: "1.0.0" },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: "list_employees",
        description: "Returns company employees with their department, salary, and performance ratings",
        inputSchema: {
          type: "object",
          properties: {
            department: {
              type: "string",
              description: "Optional filter by department (e.g. 'Engineering', 'Sales', 'Product')",
            },
          },
        },
      },
      {
        name: "award_bonus",
        description: "Awards an annual performance bonus to an employee",
        inputSchema: {
          type: "object",
          properties: {
            employeeId: { type: "string", description: "Employee ID (e.g. EMP-01)" },
            amount: { type: "number", description: "Bonus amount in USD" },
          },
          required: ["employeeId", "amount"],
        },
      },
    ],
  };
});

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  if (name === "list_employees") {
    const dept = (args as any)?.department;
    const filtered = dept
      ? mockEmployees.filter((e) => e.department.toLowerCase() === dept.toLowerCase())
      : mockEmployees;

    return {
      content: [{ type: "text", text: JSON.stringify(filtered, null, 2) }],
    };
  }

  if (name === "award_bonus") {
    const empId = (args as any)?.employeeId;
    const amount = (args as any)?.amount;
    awardedBonuses.push({ employeeId: empId, amount });

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            status: "success",
            message: `Awarded $${amount} bonus to ${empId}`,
            totalBonusesAwarded: awardedBonuses.length,
          }),
        },
      ],
    };
  }

  return {
    isError: true,
    content: [{ type: "text", text: `Unknown tool: ${name}` }],
  };
});

const transport = new StdioServerTransport();
await server.connect(transport);

