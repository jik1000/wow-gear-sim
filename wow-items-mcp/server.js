// wow-items-mcp: a tiny MCP server ("connector") that looks up WoW Forever
// item stats on Wowhead.
//
// How MCP works here, in short:
//   - Claude Code starts this file as a separate program.
//   - Claude sends us messages on "standard input" (stdin), one JSON object per line.
//   - We answer on "standard output" (stdout), also one JSON object per line.
//   - Anything we want to log goes to stderr, so it never mixes with the answers.
//
// The actual Wowhead lookup code is in wowhead.js (shared with web.js).
// No npm packages: we only use what ships with Node (fetch, readline).

const readline = require("node:readline");
const { searchItems, MAX_RESULTS } = require("./wowhead.js");

// ---------------------------------------------------------------------------
// 1. The tool we offer to Claude
// ---------------------------------------------------------------------------
const TOOLS = [
  {
    name: "search_item",
    description:
      "Look up World of Warcraft: WoW Forever item stats by item name, straight from Wowhead's WoW Forever database. " +
      "Use this instead of web search for any WoW Forever item stats. " +
      "Returns up to 5 matching items with name, id, quality, Wowhead link, the full tooltip as text lines, " +
      "and parsed stats (Strength, Agility, Stamina, Intellect, Spirit, Armor, Attack Power, Feral Attack Power, " +
      "Spell Damage (all schools, plus per-school Fire/Frost/Shadow/etc.), Healing, Hit %, Crit %, Haste %, Expertise %, " +
      "Spell Penetration, Defense, weapon damage/speed/DPS). Set bonuses are not counted in stats.",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string", description: "Item name or part of it, e.g. \"Wolfshead Helm\"." },
        limit: { type: "integer", minimum: 1, maximum: MAX_RESULTS, default: MAX_RESULTS, description: "How many matches to return (1-5)." },
      },
      required: ["name"],
    },
  },
];

async function callTool(name, args) {
  if (name !== "search_item") throw new Error(`Unknown tool: ${name}`);

  const query = String(args?.name ?? "").trim();
  if (!query) return { content: [{ type: "text", text: "Please give an item name." }], isError: true };

  try {
    const items = await searchItems(query, args?.limit);
    const result = { query, count: items.length, items };
    if (items.length === 0) result.note = "No WoW Forever items matched that name.";
    return {
      content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      structuredContent: result,
    };
  } catch (err) {
    return { content: [{ type: "text", text: `Lookup failed: ${err.message}` }], isError: true };
  }
}

// ---------------------------------------------------------------------------
// 2. The MCP message loop (JSON-RPC over stdin/stdout)
// ---------------------------------------------------------------------------
function send(message) {
  process.stdout.write(JSON.stringify(message) + "\n");
}

async function handle(msg) {
  const { id, method, params } = msg;
  const isNotification = id === undefined || id === null; // notifications get no reply

  try {
    let result;
    switch (method) {
      case "initialize":
        // The first message. We say which protocol version we speak and what we offer.
        result = {
          protocolVersion: params?.protocolVersion ?? "2025-06-18",
          capabilities: { tools: {} },
          serverInfo: { name: "wow-items", version: "1.0.0" },
        };
        break;
      case "tools/list":
        result = { tools: TOOLS };
        break;
      case "tools/call":
        result = await callTool(params?.name, params?.arguments);
        break;
      case "ping":
        result = {};
        break;
      default:
        if (isNotification) return; // e.g. "notifications/initialized": nothing to do
        send({ jsonrpc: "2.0", id, error: { code: -32601, message: `Method not found: ${method}` } });
        return;
    }
    if (!isNotification) send({ jsonrpc: "2.0", id, result });
  } catch (err) {
    if (!isNotification) send({ jsonrpc: "2.0", id, error: { code: -32603, message: err.message } });
  }
}

// Read stdin one line at a time. Each line is one JSON message.
process.stdin.setEncoding("utf8");
const rl = readline.createInterface({ input: process.stdin });
rl.on("line", (line) => {
  if (!line.trim()) return;
  let msg;
  try {
    msg = JSON.parse(line);
  } catch {
    send({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } });
    return;
  }
  handle(msg);
});
rl.on("close", () => process.exit(0));

console.error("wow-items MCP server running");
