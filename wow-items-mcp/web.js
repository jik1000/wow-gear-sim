// web.js: a tiny local web server for the Gear DPS Simulator page.
//
// Why we need it: a webpage in your browser isn't allowed to ask Wowhead
// for data directly (browsers block that, it's called "CORS"). So this
// server does two jobs:
//   1. It shows the page files (index.html, app.js, style.css).
//   2. It answers  /api/search?name=Wolfshead%20Helm  by asking Wowhead
//      (using the same code as the MCP connector) and sending back JSON.
//
// Start it with:   node wow-items-mcp\web.js
// Then open:       http://localhost:3000

const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const { searchItems, getItem } = require("./wowhead.js");

// Render (and most hosts) tell us which port to use in the PORT variable.
const PORT = Number(process.env.PORT) || 3000;
// On your PC we only listen on 127.0.0.1 (only you can open it).
// On Render (it sets RENDER=true) we must listen on 0.0.0.0 so visitors can reach us.
const HOST = process.env.HOST || (process.env.RENDER ? "0.0.0.0" : "127.0.0.1");
const PAGE_DIR = path.join(__dirname, ".."); // the folder with index.html

// Be polite to Wowhead once the page is public: each visitor gets at most
// 30 searches per minute, and search text is limited to 100 characters.
const MAX_SEARCHES_PER_MINUTE = 30;
const MAX_QUERY_LENGTH = 100;
const recentSearches = new Map(); // visitor IP -> times of their recent searches

function tooManySearches(req) {
  // Behind Render's proxy, the visitor's real IP is the first one in x-forwarded-for.
  const ip = String(req.headers["x-forwarded-for"] || req.socket.remoteAddress).split(",")[0].trim();
  const now = Date.now();
  const times = (recentSearches.get(ip) || []).filter((t) => now - t < 60_000); // keep the last minute
  times.push(now);
  recentSearches.set(ip, times);
  return times.length > MAX_SEARCHES_PER_MINUTE;
}

// Every few minutes, forget visitors who stopped searching, so memory stays small.
setInterval(() => {
  const now = Date.now();
  for (const [ip, times] of recentSearches) {
    if (times.every((t) => now - t >= 60_000)) recentSearches.delete(ip);
  }
}, 5 * 60_000).unref();

// Only these files can be opened, so nobody can read other files on your PC.
const FILES = {
  "/": ["index.html", "text/html; charset=utf-8"],
  "/index.html": ["index.html", "text/html; charset=utf-8"],
  "/app.js": ["app.js", "text/javascript; charset=utf-8"],
  "/style.css": ["style.css", "text/css; charset=utf-8"],
};

function sendJson(res, status, data) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(data));
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);

  // --- The search API the page calls ---
  if (url.pathname === "/api/search") {
    const name = (url.searchParams.get("name") || "").trim();
    if (!name) return sendJson(res, 400, { error: "Please give an item name." });
    if (name.length > MAX_QUERY_LENGTH) return sendJson(res, 400, { error: "That name is too long." });
    if (tooManySearches(req)) return sendJson(res, 429, { error: "Too many searches, please wait a minute." });
    try {
      const items = await searchItems(name, url.searchParams.get("limit"));
      return sendJson(res, 200, { query: name, count: items.length, items });
    } catch (err) {
      return sendJson(res, 502, { error: `Lookup failed: ${err.message}` });
    }
  }

  // --- A whole gear set at once (used by "Import from game") ---
  // /api/items?list=7413.12726,12029.12751,279879
  // Each entry is an item ID, then its bonus IDs after dots. Counts as ONE search
  // for the per-visitor limit, and at most 20 items per request.
  if (url.pathname === "/api/items") {
    const entries = (url.searchParams.get("list") || "").split(",").filter(Boolean);
    if (entries.length === 0 || entries.length > 20 || !entries.every((e) => /^\d{1,7}(\.\d{1,7}){0,8}$/.test(e))) {
      return sendJson(res, 400, { error: "Expected up to 20 items like 7413.12726" });
    }
    if (tooManySearches(req)) return sendJson(res, 429, { error: "Too many searches, please wait a minute." });
    try {
      const items = await Promise.all(entries.map((entry) => {
        const [id, ...bonuses] = entry.split(".");
        return getItem(Number(id), bonuses);
      }));
      return sendJson(res, 200, { items }); // same order as the list; null = not found
    } catch (err) {
      return sendJson(res, 502, { error: `Lookup failed: ${err.message}` });
    }
  }

  // --- The page files ---
  const file = FILES[url.pathname];
  if (!file) {
    res.writeHead(404, { "Content-Type": "text/plain" });
    return res.end("Not found");
  }
  fs.readFile(path.join(PAGE_DIR, file[0]), (err, content) => {
    if (err) {
      res.writeHead(500, { "Content-Type": "text/plain" });
      return res.end("Could not read " + file[0]);
    }
    // "no-store" so the browser always shows your newest edits.
    res.writeHead(200, { "Content-Type": file[1], "Cache-Control": "no-store" });
    res.end(content);
  });
});

server.listen(PORT, HOST, () => {
  console.log(`Gear page running at http://localhost:${PORT} on ${HOST}  (press Ctrl+C to stop)`);
});
