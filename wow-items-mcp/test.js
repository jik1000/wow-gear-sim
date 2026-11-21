// test.js: starts server.js the same way Claude Code does, sends it MCP
// messages, and checks the answers. Run with:  node test.js
//
// (We do this in Node instead of piping JSON in PowerShell, because
// PowerShell can mangle the text encoding.)

const { spawn } = require("node:child_process");
const path = require("node:path");

// Start the server as a child program.
const server = spawn(process.execPath, [path.join(__dirname, "server.js")], {
  stdio: ["pipe", "pipe", "inherit"], // stderr shows up directly in our console
});
server.stdout.setEncoding("utf8");

// Collect replies. Each reply is one line of JSON, matched to our request by "id".
const waiting = new Map();
let buffer = "";
server.stdout.on("data", (chunk) => {
  buffer += chunk;
  let i;
  while ((i = buffer.indexOf("\n")) >= 0) {
    const line = buffer.slice(0, i);
    buffer = buffer.slice(i + 1);
    if (!line.trim()) continue;
    const msg = JSON.parse(line);
    waiting.get(msg.id)?.(msg);
    waiting.delete(msg.id);
  }
});

let nextId = 1;
function request(method, params) {
  const id = nextId++;
  server.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
  return new Promise((resolve) => waiting.set(id, resolve));
}
function notify(method, params) {
  server.stdin.write(JSON.stringify({ jsonrpc: "2.0", method, params }) + "\n");
}

let failures = 0;
function check(label, ok) {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}`);
  if (!ok) failures++;
}

async function main() {
  // 1. Handshake, like Claude does.
  const init = await request("initialize", {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: { name: "test.js", version: "1.0" },
  });
  check("initialize works", init.result?.serverInfo?.name === "wow-items");
  notify("notifications/initialized");

  // 2. Ask which tools exist.
  const list = await request("tools/list");
  check("search_item tool is listed", list.result?.tools?.some((t) => t.name === "search_item"));

  // 3. Look up Wolfshead Helm.
  const call = await request("tools/call", { name: "search_item", arguments: { name: "Wolfshead Helm" } });
  const items = call.result?.structuredContent?.items ?? [];
  const helm = items.find((it) => it.name === "Wolfshead Helm");
  check("Wolfshead Helm found", !!helm);
  if (helm) {
    console.log("\n--- Wolfshead Helm ---");
    console.log(JSON.stringify(helm, null, 2));
    console.log();
    check("Armor is 109", helm.stats.armor === 109);
    check("Spirit is 10", helm.stats.spirit === 10);
  }

  // 4. A set item: crit and AP from Equip lines count, the "(2) Set:" hit bonus must NOT.
  const gloves = (await request("tools/call", { name: "search_item", arguments: { name: "Devilsaur Gauntlets", limit: 1 } }))
    .result?.structuredContent?.items?.[0];
  check("Devilsaur Gauntlets: crit 1%, AP 28, set bonus hit ignored",
    gloves?.stats.critPercent === 1 && gloves?.stats.attackPower === 28 && gloves?.stats.hitPercent === 0);

  // 5. A weapon: damage, speed and DPS.
  const reaper = (await request("tools/call", { name: "search_item", arguments: { name: "Arcanite Reaper", limit: 1 } }))
    .result?.structuredContent?.items?.[0];
  check("Arcanite Reaper: 153-256 dmg, speed 3.8, AP 62",
    reaper?.stats.weapon?.min === 153 && reaper?.stats.weapon?.max === 256 &&
    reaper?.stats.weapon?.speed === 3.8 && reaper?.stats.attackPower === 62);

  // 6. Stat wordings that were missed before (found by scanning 220 items).
  async function find(name, id) {
    const res = await request("tools/call", { name: "search_item", arguments: { name } });
    return res.result?.structuredContent?.items?.find((it) => it.id === id);
  }
  const cosmos = await find("Cloak of the Cosmos", 18389);
  check("Cloak of the Cosmos: new wording gives Healing 20 + Spell Damage 7",
    cosmos?.stats.healing === 20 && cosmos?.stats.spellDamage === 7);
  const soranruk = await find("Staff of Soran'ruk", 15109);
  check("Staff of Soran'ruk: Shadow 34 and Fire 34 school damage",
    soranruk?.stats.schoolSpellDamage.shadow === 34 && soranruk?.stats.schoolSpellDamage.fire === 34);
  const dagger = await find("Distracting Dagger", 18392);
  check("Distracting Dagger: Expertise 0.5%", dagger?.stats.expertisePercent === 0.5);
  const pauldrons = await find("Pauldrons of Elements", 16669);
  check("Pauldrons of Elements: Spell Penetration 2", pauldrons?.stats.spellPenetration === 2);

  // 7. Asking again should come from the cache (much faster).
  const t0 = Date.now();
  await request("tools/call", { name: "search_item", arguments: { name: "Wolfshead Helm", limit: 1 } });
  console.log(`(second Wolfshead lookup took ${Date.now() - t0} ms; only the search is re-fetched)`);

  console.log(failures === 0 ? "\nAll tests passed." : `\n${failures} test(s) failed.`);
  server.stdin.end(); // closing stdin makes the server exit
  process.exitCode = failures === 0 ? 0 : 1;
}

main().catch((err) => {
  console.error(err);
  server.kill();
  process.exitCode = 1;
});
