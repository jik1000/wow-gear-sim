// wowhead.js: everything about getting item stats from Wowhead's WoW Forever
// database. Both server.js (the MCP connector for Claude) and web.js (the
// local web server for the gear page) use this file, so the logic lives in
// one place.

// ---------------------------------------------------------------------------
// 1. Settings
// ---------------------------------------------------------------------------
const SEARCH_URL = "https://www.wowhead.com/forever/search/suggestions-template?q=";
const TOOLTIP_URL = "https://nether.wowhead.com/forever/tooltip/item/";
const ITEM_PAGE_URL = "https://www.wowhead.com/forever/item=";
const USER_AGENT = "wow-items-mcp/1.0 (personal item lookup tool)";
const TIMEOUT_MS = 10_000; // give up on Wowhead after 10 seconds
const MAX_RESULTS = 5;

const QUALITY_NAMES = ["Poor", "Common", "Uncommon", "Rare", "Epic", "Legendary", "Artifact", "Heirloom"];

// Items we already looked up, keyed by item id. A Map is like a dictionary.
// It lives as long as the program runs, so the same item is only fetched once.
const itemCache = new Map();

// ---------------------------------------------------------------------------
// 2. Talking to Wowhead
// ---------------------------------------------------------------------------

// Download a URL and parse it as JSON, with our User-Agent and a timeout.
async function getJson(url) {
  const response = await fetch(url, {
    headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
    signal: AbortSignal.timeout(TIMEOUT_MS), // cancels the request if it takes too long
  });
  if (!response.ok) throw new Error(`Wowhead returned HTTP ${response.status} for ${url}`);
  return response.json();
}

// Fetch one item's tooltip (or reuse it from the cache).
// bonuses: optional list of bonus IDs from the game's item link. Random-suffix
// items like "Infiltrator Cap of the Wolf" store their extra stats as a bonus
// (e.g. 12726), and Wowhead adds those stats when we pass ?bonus=12726.
// Returns null when the item doesn't exist in WoW Forever (empty tooltip).
async function getItem(id, bonuses = []) {
  const key = bonuses.length ? `${id}|${bonuses.join(":")}` : id;
  if (itemCache.has(key)) return itemCache.get(key);

  let item = null;
  try {
    const query = bonuses.length ? "?bonus=" + bonuses.join(":") : "";
    const data = await getJson(TOOLTIP_URL + id + query);
    if (data && typeof data.tooltip === "string" && data.tooltip.trim() !== "") {
      const lines = tooltipToLines(data.tooltip);
      item = {
        name: data.name,
        id,
        bonuses,
        quality: QUALITY_NAMES[data.quality] ?? String(data.quality),
        link: ITEM_PAGE_URL + id + (bonuses.length ? "?bonus=" + bonuses.join(":") : ""),
        stats: parseStats(lines),
        tooltip: lines,
      };
    }
  } catch (err) {
    // One broken item shouldn't break the whole search, so log it and skip it.
    console.error(`Could not fetch item ${id}: ${err.message}`);
    return null; // don't cache failures, so a later retry can work
  }

  itemCache.set(key, item); // empty-tooltip items are cached as null too
  return item;
}

// Search Wowhead by name and return up to `limit` items that exist in WoW Forever.
async function searchItems(name, limit = MAX_RESULTS) {
  limit = Math.min(MAX_RESULTS, Math.max(1, Math.floor(Number(limit) || MAX_RESULTS)));
  const data = await getJson(SEARCH_URL + encodeURIComponent(name));
  const results = Array.isArray(data?.results) ? data.results : [];

  // "type": 3 means "item". Other types are spells, NPCs, quests, etc.
  const itemIds = results.filter((r) => r.type === 3).map((r) => r.id);

  const found = [];
  for (const id of itemIds) {
    if (found.length >= limit) break;
    const item = await getItem(id);
    if (item) found.push(item); // skip items missing from WoW Forever
  }
  return found;
}

// ---------------------------------------------------------------------------
// 3. Turning tooltip HTML into plain text lines
// ---------------------------------------------------------------------------
function tooltipToLines(html) {
  let text = html
    // Wowhead hides markers like <!--rtg38--> inside numbers. Remove them all first.
    .replace(/<!--[\s\S]*?-->/g, "")
    // These tags mean "new line" in the tooltip layout.
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/?(div|p|tr|td|th|table)\b[^>]*>/gi, "\n")
    // Every other tag (<span>, <a>, <b>...) is just removed.
    .replace(/<[^>]+>/g, "");

  // Turn HTML codes like &amp; back into normal characters.
  text = text
    .replace(/&nbsp;/g, " ")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&amp;/g, "&");

  // Tidy spaces, drop empty lines.
  return text
    .split("\n")
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter((line) => line !== "");
}

// ---------------------------------------------------------------------------
// 4. Reading stats out of the text lines
// ---------------------------------------------------------------------------
function parseStats(lines) {
  const stats = {
    strength: 0, agility: 0, stamina: 0, intellect: 0, spirit: 0,
    armor: 0,
    attackPower: 0,
    feralAttackPower: 0,
    spellDamage: 0,        // damage for ALL spell schools
    schoolSpellDamage: { arcane: 0, fire: 0, frost: 0, holy: 0, nature: 0, shadow: 0 }, // one school only
    healing: 0,
    hitPercent: 0,
    critPercent: 0,
    spellHitPercent: 0,    // "chance to hit with spells" (spells only)
    spellCritPercent: 0,   // "Critical Strike with Spells" (spells only)
    hastePercent: 0,
    expertisePercent: 0,   // "Reduces chance to be Dodged or Parried by N%"
    spellPenetration: 0,   // "Your spells pierce N Magical Resistance"
    defense: 0,
    weapon: null, // filled in only for weapons
  };

  // Weapon slot ("Main Hand", "Off Hand", "Ranged"...) and type ("Sword", "Bow"...).
  // They sit on their own lines just above the damage line.
  let slot = null, type = null;

  for (const line of lines) {
    // Recipes ("Pattern: ...", "Plans: ...") show the crafted item's tooltip
    // after this line. Those stats belong to the crafted item, so stop here.
    if (/^Use: Teaches you how to/i.test(line)) break;

    // --- Base stats: lines like "+10 Spirit" or "-5 Agility" ---
    let m = line.match(/^([+-]\d+) (Strength|Agility|Stamina|Intellect|Spirit)$/);
    if (m) {
      stats[m[2].toLowerCase()] += Number(m[1]);
      continue;
    }

    // --- Armor: "109 Armor" (or "+260 Armor" for bonus armor) ---
    m = line.match(/^\+?(\d+) Armor$/);
    if (m) {
      stats.armor += Number(m[1]);
      continue;
    }

    // --- Weapon lines ---
    if (/^(One-Hand|Two-Hand|Main Hand|Off Hand|Ranged|Thrown)$/.test(line)) { slot = line; continue; }
    if (slot && !type && /^(Axe|Bow|Crossbow|Dagger|Fist Weapon|Gun|Mace|Polearm|Staff|Sword|Wand|Thrown|Fishing Pole)$/.test(line)) {
      type = line;
      continue;
    }
    // "153 - 256 Damage", or for wands "30 - 57 Shadow Damage"
    m = line.match(/^(\d+) - (\d+)(?: [A-Z][a-z]+)? Damage$/);
    if (m && !stats.weapon?.min) {
      stats.weapon = { ...stats.weapon, min: Number(m[1]), max: Number(m[2]) };
      continue;
    }
    m = line.match(/^Speed (\d+(?:\.\d+)?)$/);
    if (m) {
      stats.weapon = { ...stats.weapon, speed: Number(m[1]) };
      continue;
    }
    m = line.match(/^\((\d+(?:\.\d+)?) damage per second\)$/);
    if (m) {
      stats.weapon = { ...stats.weapon, dps: Number(m[1]) };
      continue;
    }

    // --- Everything else only counts on "Equip:" lines. ---
    // Set bonuses look like "(2) Set : ..." so they never start with "Equip:".
    if (!line.startsWith("Equip:")) continue;
    const effect = line.slice("Equip:".length).trim();

    // Feral attack power: "+N Attack Power in Cat, Bear, and Dire Bear forms only."
    // Checked before normal attack power because both mention "Attack Power".
    m = effect.match(/\+(\d+) Attack Power in Cat/i) || effect.match(/attack power by (\d+) in Cat/i);
    if (m) { stats.feralAttackPower += Number(m[1]); continue; }

    // Normal attack power: "+62 Attack Power." (but not ranged attack power)
    m = effect.match(/^\+(\d+) Attack Power\.?$/i) || effect.match(/^Increases attack power by (\d+)\.?$/i);
    if (m) { stats.attackPower += Number(m[1]); continue; }

    // Spell damage AND healing: "Increases damage and healing done by magical spells and effects by up to 60."
    m = effect.match(/damage and healing done by magical spells and effects by up to (\d+)/i);
    if (m) { stats.spellDamage += Number(m[1]); stats.healing += Number(m[1]); continue; }

    // New WoW Forever wording with two different numbers:
    // "Increases healing done by up to 20 and damage done by up to 7 for all magical spells and effects."
    m = effect.match(/healing done by up to (\d+) and damage done by up to (\d+) for all magical spells/i);
    if (m) { stats.healing += Number(m[1]); stats.spellDamage += Number(m[2]); continue; }
    m = effect.match(/damage done by up to (\d+) and healing done by up to (\d+) for all magical spells/i);
    if (m) { stats.spellDamage += Number(m[1]); stats.healing += Number(m[2]); continue; }

    // Third wording: "Increases spell damage and healing by up to 18." (or "spell power by 18")
    m = effect.match(/spell damage and healing by up to (\d+)/i) || effect.match(/^Increases spell power by (\d+)/i);
    if (m) { stats.spellDamage += Number(m[1]); stats.healing += Number(m[1]); continue; }

    // One spell school only: "Increases damage done by Fire spells and effects by up to 34."
    m = effect.match(/^Increases damage done by (Arcane|Fire|Frost|Holy|Nature|Shadow) spells and effects by up to (\d+)/i);
    if (m) { stats.schoolSpellDamage[m[1].toLowerCase()] += Number(m[2]); continue; }

    // Healing only: "Increases healing done by spells and effects by up to 44."
    m = effect.match(/healing done by spells and effects by up to (\d+)/i);
    if (m) { stats.healing += Number(m[1]); continue; }

    // Spell damage only: "Increases damage done by magical spells and effects by up to 20."
    m = effect.match(/^Increases damage done by magical spells and effects by up to (\d+)/i);
    if (m) { stats.spellDamage += Number(m[1]); continue; }

    // Spell-only hit and crit: "Improves your chance to hit with spells by 1%." and
    // "Improves your chance to get a Critical Strike with Spells by 1.0%."
    // Kept separate, because they only help casters.
    m = effect.match(/chance to hit with spells by (\d+(?:\.\d+)?)%/i);
    if (m) { stats.spellHitPercent += Number(m[1]); continue; }
    m = effect.match(/chance to get a critical strike with spells by (\d+(?:\.\d+)?)%/i);
    if (m) { stats.spellCritPercent += Number(m[1]); continue; }

    // Hit: "Improves your chance to hit by 2.0%." (works for everyone)
    m = effect.match(/chance to hit by (\d+(?:\.\d+)?)%/i);
    if (m) { stats.hitPercent += Number(m[1]); continue; }

    // Crit: "Improves your chance to get a critical strike by 1.0%." (works for everyone)
    m = effect.match(/chance to get a critical strike by (\d+(?:\.\d+)?)%/i);
    if (m) { stats.critPercent += Number(m[1]); continue; }

    // Haste: "Increases your attack speed by 2%." / "Improves your haste by 2%."
    m = effect.match(/(?:attack speed|haste) by (\d+(?:\.\d+)?)%/i);
    if (m) { stats.hastePercent += Number(m[1]); continue; }

    // Expertise: "Reduces chance to be Dodged or Parried by 0.5%."
    m = effect.match(/chance to be Dodged or Parried by (\d+(?:\.\d+)?)%/i);
    if (m) { stats.expertisePercent += Number(m[1]); continue; }

    // Spell penetration: "Your spells pierce 2 Magical Resistance."
    // (Classic wording: "Decreases the magical resistances of your spell targets by 10.")
    m = effect.match(/spells pierce (\d+) (?:Magical )?Resistance/i) ||
        effect.match(/magical resistances of your spell targets by (\d+)/i);
    if (m) { stats.spellPenetration += Number(m[1]); continue; }

    // Defense: "Increased Defense +10."
    m = effect.match(/Defense \+(\d+)/i);
    if (m) { stats.defense += Number(m[1]); continue; }
  }

  if (stats.weapon) stats.weapon = { ...stats.weapon, slot, type };

  // Avoid tiny rounding errors like 1.5000000002 when adding percentages.
  for (const k of ["hitPercent", "critPercent", "spellHitPercent", "spellCritPercent", "hastePercent", "expertisePercent"]) stats[k] = Math.round(stats[k] * 100) / 100;
  return stats;
}

// Share these with the other files that "require" this one.
module.exports = { searchItems, getItem, MAX_RESULTS };
