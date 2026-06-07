# Step 7 — MCP Server (sagewayai-mcp)

A learning MCP server written in TypeScript using the official `@modelcontextprotocol/sdk`. The server exposes a parable library through three MCP primitives: a tool for searching, a resource with categories, and a prompt template. The goal is to understand in practice the difference between `tool`, `resource`, and `prompt`, learn the `stdio` transport layer, and work through error handling and logging inside MCP handlers.

---

## Running Locally

```bash
cd 02-mcp
npm install

# Development mode (tsx, no compilation step)
npm run dev

# Production build
npm run build
npm start
```

> The server listens on stdin/stdout — running it manually in a terminal does nothing useful.  
> It is designed to be spawned by an MCP client (Claude Code, Claude Desktop).

---

## Connecting to Claude Code

Add to `.mcp.json` in the project root:

```json
{
  "mcpServers": {
    "sagewayai-mcp": {
      "type": "stdio",
      "command": "node",
      "args": ["02-mcp/dist/index.js"]
    }
  }
}
```

Or for development mode (no build required):

```json
{
  "mcpServers": {
    "sagewayai-mcp": {
      "type": "stdio",
      "command": "npx",
      "args": ["tsx", "02-mcp/src/index.ts"]
    }
  }
}
```

After updating the config, restart Claude Code: `/mcp` → confirm the server appears in the list.

---

## What the Server Provides

| Primitive | Name | Description |
|---|---|---|
| **Tool** | `search_parables` | Searches parables by topic or situation. Accepts `query: string`, returns an array of `{ title, text, moral }`. |
| **Resource** | `parables://categories` | Static list of parable categories (`wisdom`, `patience`, `leadership`, …). Read-only, no side effects. |
| **Prompt** | `suggest_parable` | Conversation template: accepts `situation`, returns a ready `messages[]` to pass to the LLM. |

### Logging

Every `search_parables` call sends two types of messages to the client via `server.sendLoggingMessage`:

- `level: "info"` — logs the incoming `query` before the search runs.
- `level: "error"` — logs the error if the search fails. The response is returned with `isError: true` (a controlled failure, not an exception).

---

## Relationship to Step 6 — How an MCP Server Differs from an Agent

| Aspect | Step 6 — Agent (`parable-agent.ts`) | Step 7 — MCP Server |
|---|---|---|
| **What it does** | Calls the Claude API, manages the conversation, decides what to do and when | Passively waits for client requests, executes one action per call |
| **Who controls the logic** | The agent — it has a loop, memory, and planning | The client (LLM / Claude Code) — the server is just a tool |
| **Protocol** | HTTP / Anthropic API | JSON-RPC 2.0 over stdio (MCP) |
| **Relationship to LLM** | Direct: the agent makes requests to Claude itself | Indirect: the LLM decides when to call the tool and interprets the result |
| **Reusability** | A single script, run manually | Connects to any MCP client (Claude Code, Claude Desktop, IDE) |
| **When to use** | Autonomous multi-step tasks | Extending the capabilities of an existing client |
