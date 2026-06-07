// MCP Server entry point

// McpServer is the high-level class from the official SDK.
// It manages the server lifecycle: registers tools, resources, and prompts,
// and handles JSON-RPC requests from the client.
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

// StdioServerTransport is the transport layer over stdin/stdout.
// The MCP client (e.g. Claude Desktop) spawns this process
// and communicates with it via standard I/O streams.
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

// zod is used to define the input parameter schema for tools.
// The MCP SDK reads this schema and automatically generates JSON Schema
// for the client — so the client knows which fields each tool expects.
import { z } from "zod";

// Creates the server instance.
// name and version are metadata the client receives during the handshake (initialize).
// The client uses them for logging and compatibility checks.
const server = new McpServer({
  name: "sagewayai-mcp",
  version: "1.0.0",
});

// Three parables — the data returned by the tool.
// In a real project this would be a database query or an external API call.
const parables = [
  {
    title: "The Farmer and the Well",
    text: "A farmer dug a well for months without finding water. His neighbor urged him to stop, but the farmer replied: 'Each day I dig, I am one day closer to water.' On the final day of the third month, water burst from the ground.",
    moral: "Patience is not waiting — it is continuing to act while waiting.",
  },
  {
    title: "The Bamboo Tree",
    text: "A gardener planted a bamboo seed and watered it every day for four years without seeing a single sprout. In the fifth year, the bamboo grew ninety feet in six weeks. The roots had been growing unseen the whole time.",
    moral: "Growth that is invisible is still growth. Do not abandon what you cannot yet see.",
  },
  {
    title: "The River and the Stone",
    text: "A young river raged against a boulder blocking its path, wearing itself out in foam and noise. An old river nearby flowed around the same kind of stone — quietly, without rushing — and carved a canyon over a thousand years.",
    moral: "Patience shapes the world more surely than force.",
  },
];

// server.registerTool() is the current way to register a tool (server.tool() is deprecated).
// Arguments:
//   1. tool name — the identifier the client uses to call it
//   2. metadata: title (human-readable), description (the LLM reads this to decide when to call it),
//      inputSchema (zod schema → SDK converts it to JSON Schema for the client)
//   3. handler — the function that runs when the client calls the tool
server.registerTool(
  "search_parables",
  {
    title: "Search Parables",
    description:
      "Search the parable library for stories that match the user's situation, " +
      "theme, or emotional need. Call this tool whenever the user asks to find, " +
      "suggest, or recommend a parable — for example 'find a parable about patience' " +
      "or 'I need a story about leadership'. Returns a list of matching parables " +
      "with their titles and morals.",
    // inputSchema accepts a zod object directly.
    // z.string().describe() — the field description is included in the JSON Schema
    // and helps the LLM understand what value to pass for this parameter.
    inputSchema: z.object({
      query: z.string().describe("the topic or situation to search parables for"),
    }),
  },
  // The handler receives already-validated parameters.
  // The return format — { content: [...] } — is the MCP standard.
  // type: "text" means a text block; "image" and "resource" are also valid.
  //
  // isError: true vs throwing an exception:
  //   isError: true  — the tool completed normally but the result represents an error.
  //                    The client (LLM) receives content[] with the error description and
  //                    can act on it: inform the user, try a different query, etc.
  //   throw Error    — the tool crashed unexpectedly. The SDK catches the exception and
  //                    returns a protocol-level error (JSON-RPC error object) to the client.
  //                    The client does not receive content[] — only an error code and message.
  //                    Use throw only when the error was completely unexpected.
  async ({ query }) => {
    await server.sendLoggingMessage({
      level: "info",
      data: `search_parables called with query="${query}"`,
    });

    try {
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(parables, null, 2),
          },
        ],
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);

      await server.sendLoggingMessage({
        level: "error",
        data: `search_parables failed for query="${query}": ${message}`,
      });

      return {
        content: [
          {
            type: "text" as const,
            text: `Error searching parables: ${message}`,
          },
        ],
        isError: true,
      };
    }
  }
);

// ── RESOURCE ─────────────────────────────────────────────────────────────────
//
// Resource is a read-only primitive.
// The client requests data by URI; the server does not mutate any state.
// Difference from tool:
//   tool     → may have side effects (write to DB, call an API, send an email)
//   resource → pure read, like a GET request. The client knows nothing will break.
//
// Why "parables://" and not "/api/categories":
//   MCP resources are not HTTP. The URI here is just a unique identifier
//   within the protocol. A custom scheme "parables://" makes it explicit that
//   the data belongs to this server and not some HTTP endpoint.
//   This lets clients distinguish resources from different servers without collisions.

const categories = ["wisdom", "patience", "leadership", "courage", "humility"];

server.registerResource(
  // name — internal resource identifier on the server
  "parable-categories",
  // uri — the address the client uses to request the resource
  "parables://categories",
  // metadata — does not include name (it is already in the first argument)
  {
    description: "Static list of available parable categories",
    mimeType: "application/json",
  },
  // uri here is a URL object; uri.href gives the string "parables://categories"
  async (uri) => ({
    contents: [
      {
        uri: uri.href,
        mimeType: "application/json",
        text: JSON.stringify(categories, null, 2),
      },
    ],
  })
);

// ── PROMPT ────────────────────────────────────────────────────────────────────
//
// Prompt is a registered conversation template.
// The client calls it by name with arguments and receives a ready messages[]
// that can be passed directly to the LLM.
//
// Why use prompts instead of writing the request manually:
//   1. Reuse — one template works across different clients
//      (Claude Desktop, IDE, custom chat) without copying text.
//   2. Parameterization — the client passes only variables (situation),
//      and the server assembles the full prompt with system instructions.
//   3. Versioning — update the prompt on the server and all clients
//      get the improved version without redeploying on their side.

server.registerPrompt(
  "suggest_parable",
  // metadata as an object — description + argsSchema together
  {
    title: "Suggest Parable",
    description: "Find a parable that fits a specific life situation",
    // argsSchema accepts a raw shape — just the fields without a z.object() wrapper;
    // the SDK wraps them internally
    argsSchema: {
      situation: z.string().describe("the user's life situation"),
    },
  },
  ({ situation }) => ({
    messages: [
      {
        role: "user",
        content: {
          type: "text",
          text:
            `You are a wise parable storyteller. Your task is to find or compose a parable ` +
            `that helps the person reframe their situation.\n\n` +
            `Situation: ${situation}\n\n` +
            `Tell one parable and explain what lesson it carries as it applies to this situation.`,
        },
      },
    ],
  })
);

// Creates the transport over stdin/stdout.
// The client spawns this process and reads its output — all communication
// happens via JSON-RPC text messages over standard streams.
const transport = new StdioServerTransport();

// Connects the server to the transport and starts it.
// After this the server listens for incoming JSON-RPC requests from the client.
await server.connect(transport);
