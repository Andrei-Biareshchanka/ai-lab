import Anthropic from "@anthropic-ai/sdk";
import { anthropic as client } from "../shared/client.js";

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

function searchParables(query: string): string {
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

  return JSON.stringify(parables, null, 2);
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
        resultContent = searchParables(query);
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
