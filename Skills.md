# Agent Skill: Interacting with OpenCodeMode

## Description
This skill guides AI agents in constructing and executing optimal TypeScript/JavaScript code when interacting with an OpenCodeMode MCP server.

---

## When to Use Code Mode
Use `execute_code` whenever a user request requires:
1. Multi-step operations across tools (e.g., fetch, filter, sort, and transform data).
2. Processing large collections where only a subset or summary of the data is needed.
3. Complex conditional logic or parallel processing across endpoints.

---

## The Sandbox Environment
Inside the sandbox, a global `mcp` object is available. Every tool exposed by the downstream MCP server is exposed as an async function on `mcp`.

```typescript
// Example call:
const result = await mcp.tool_name({ param1: "value" });
```

---

## Best Practices for Agent Code Generation

### 1. In-Memory Filtering (The Primary Value Proposition)
Never return massive arrays back to the LLM context. Always filter, map, and slice data inside the sandbox script before returning.

**Good:**
```typescript
async () => {
  const users = await mcp.list_users({ status: "active" });
  // Filter and pick only necessary fields:
  return users
    .filter(u => u.role === "admin" && u.lastLoginDaysAgo < 7)
    .map(u => ({ id: u.id, username: u.username, email: u.email }));
};
```

**Anti-Pattern (Defeats the purpose of Code Mode):**
```typescript
async () => {
  // DON'T return 5,000 raw objects directly into the context window!
  return await mcp.list_users();
};
```

### 2. Parallel Requests via `Promise.all`
Take advantage of JavaScript's async event loop to fetch independent resources concurrently.

```typescript
async () => {
  const [issues, pullRequests] = await Promise.all([
    mcp.list_issues({ state: "open" }),
    mcp.list_pull_requests({ state: "open" })
  ]);
  return {
    openIssuesCount: issues.length,
    openPrsCount: pullRequests.length
  };
};
```

### 3. Graceful Error Handling
Wrap risky operations in `try/catch` blocks inside your script so partial failures don't abort the entire workflow without diagnostic feedback:

```typescript
async () => {
  const results = [];
  const ids = [1, 2, 3, 4];
  for (const id of ids) {
    try {
      const data = await mcp.get_item({ id });
      results.push(data);
    } catch (err) {
      results.push({ id, error: String(err) });
    }
  }
  return results;
};
```

---

## Restrictions in the Sandbox
1. **No External Network:** Do not call `fetch("https://...")` or create raw sockets. All external I/O must go through the provided `mcp` tools.
2. **No Direct Filesystem:** Do not use `Deno.readTextFile()` or `fs`. Use MCP filesystem tools if available.
3. **Execution Timeout:** Keep scripts optimized to complete within 15 seconds.

