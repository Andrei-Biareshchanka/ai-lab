import * as dotenv from "dotenv";
dotenv.config();

import Anthropic from "@anthropic-ai/sdk";

const client = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

const tools: Anthropic.Tool[] = [
  {
    name: "search_parables",
    description:
      "Search the parable library for stories that match the user's situation, " +
      "theme, or emotional need. Call this tool whenever the user asks to find, " +
      "suggest, or recommend a parable — for example 'find a parable about patience' " +
      "or 'I need a story about leadership'. Returns a list of matching parables " +
      "with their titles and morals.",
    input_schema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description:
            "The theme, situation, or emotional topic to search for. " +
            "Examples: 'patience', 'dealing with failure', 'trust in difficult times'.",
        },
      },
      required: ["query"],
    },
  },
];

async function searchParables(query: string): Promise<string> {
  const response = await fetch("https://sagewayai.onrender.com/api/parables/search", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query, k: 5 }),
  });

  if (!response.ok) {
    throw new Error(`Search API error ${response.status}`);
  }

  const data = await response.json() as { data: unknown[] };
  return JSON.stringify(data.data, null, 2);
}

// Maximum number of loop iterations before we forcibly stop.
// Why: Claude could theoretically keep calling tools forever — bad prompt, bug in
// tool description, or a model that gets "stuck". Without a cap we'd burn API
// credits and never return. 10 is generous for any realistic single-question flow.
const MAX_ITERATIONS = 10;

async function main() {
  const messages: Anthropic.MessageParam[] = [
    { role: "user", content: "подбери притчу про терпение" },
  ];

  let iteration = 0;

  while (true) {
    // ── Guard: stop runaway loops ─────────────────────────────────────────────
    // Checked at the TOP of each iteration so we never make a request we can't
    // afford. If we hit the limit, warn and exit — better than a silent hang.
    if (iteration >= MAX_ITERATIONS) {
      console.warn(`\n⚠ reached ${MAX_ITERATIONS} iterations without end_turn — stopping.`);
      break;
    }
    iteration++;
    console.log(`\n[iteration ${iteration}]`);

    // ── Step 1: call Claude with the full conversation history ────────────────
    const response = await client.messages.create({
      model: "claude-sonnet-4-5",
      max_tokens: 1024,
      system:
        "You are a parable guide. When the user describes a situation or asks for wisdom, " +
        "always use the search_parables tool to find relevant parables from the library. " +
        "Never invent or recall parables from memory — only use what the tool returns. " +
        "After receiving results, choose the most fitting parable and explain why it speaks to the user's situation.",
      tools,
      messages,
    });

    // ── Step 2: done if Claude replied with text ──────────────────────────────
    if (response.stop_reason !== "tool_use") {
      const textBlock = response.content.find((b) => b.type === "text");
      console.log("\n── финальный ответ ──────────────────────────────────────");
      console.log(textBlock?.text ?? "(no text in response)");
      break;
    }

    // ── Step 3: add Claude's turn (with tool_use blocks) to history ───────────
    messages.push({ role: "assistant", content: response.content });

    // ── Step 4: execute ALL tools Claude requested in this turn ───────────────
    // Claude may ask for several tools at once. We must return a result for
    // every tool_use block — omitting even one causes an API error on the next call.
    const toolResultContents: Anthropic.ToolResultBlockParam[] = [];

    for (const block of response.content) {
      if (block.type !== "tool_use") continue;

      const query = (block.input as { query: string }).query;
      console.log(`\n── модель просит ${block.name} с query="${query}" ──`);
      console.log("── исполняю ─────────────────────────────────────────────");

      // ── Error isolation: catch failures per tool, not for the whole loop ────
      // Why: if searchParables throws (DB down, bad input, bug), we must still
      // return a tool_result for this block.id — otherwise the API rejects the
      // next request entirely ("missing tool result for id ...").
      // Returning is_error: true tells Claude something went wrong so it can
      // respond gracefully ("I couldn't find parables, try rephrasing").
      let resultContent: string;
      let isError = false;

      try {
        resultContent = await searchParables(query);
        console.log("── возвращаю результат ──────────────────────────────────");
        console.log(resultContent);
      } catch (err) {
        isError = true;
        resultContent = err instanceof Error ? err.message : "unknown error";
        console.error(`── ошибка в ${block.name}: ${resultContent}`);
      }

      toolResultContents.push({
        type: "tool_result",
        tool_use_id: block.id,
        content: resultContent,
        is_error: isError,
      });
    }

    // ── Step 5: return all results in one "user" message ──────────────────────
    // All results go in a single push — the API requires them bundled together,
    // not as separate messages.
    messages.push({ role: "user", content: toolResultContents });
  }
}

main();
