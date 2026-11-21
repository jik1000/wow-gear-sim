// app.js: the BEHAVIOR of the page (the math and the updating).
//
// HOW THE WEIGHTS WORK
// A weight = how many % more DPS you get from +1 of a stat.
// Instead of guessing every weight, we only set a few "base" weights
// (Crit %, Hit %, Haste %, and for casters Spell Damage) and CALCULATE
// the rest from each class's real stat conversions, for example:
//   Feral Druid: 1 Strength = 2 Attack Power, so Strength is worth 2 x Attack Power.
//
// Source for the conversions: Warcraft Tavern's WoW Forever stats guide
// https://www.warcrafttavern.com/forever/guides/stats/
//   - 14 Attack Power = +1 DPS
//   - Strength gives 2 AP (Warrior, Paladin, Shaman, Druid) or 1 AP (everyone else)
//   - Agility gives 1 melee AP (Rogue, Cat Form Druid) or 2 ranged AP (Hunter)
//   - 1% crit per 20 Agility (Warrior, Paladin, Shaman, Druid), 29 (Rogue), 53 (Hunter)
//   - 1% spell crit per 54-60 Intellect (Paladin 54 ... Warlock 60)
//   - Melee crits do +100% damage, spell crits +50%
//   - Raid bosses: melee misses 9%, spells miss 16%

// One entry per damage spec.
//   kind:       "physical" (uses Attack Power) or "caster" (uses Spell Damage)
//   strAP:      Attack Power per Strength
//   agiAP:      Attack Power per Agility
//   agiPerCrit: Agility needed for +1% crit (0 = Agility gives no crit)
//   intPerCrit: Intellect needed for +1% spell crit (0 = not used)
//   weapon:     true if the weapon's own damage (Weapon DPS) matters for this spec
// Healer and tank specs are left out because this tool measures damage.
const PHYS = (strAP, agiAP, agiPerCrit, weapon = true) =>
  ({ kind: "physical", strAP, agiAP, agiPerCrit, intPerCrit: 0, weapon });
// Only Paladin (54) and Warlock (60) are named in the source; 57 is a middle guess for the others.
const CASTER = (intPerCrit) => ({ kind: "caster", strAP: 0, agiAP: 0, agiPerCrit: 0, intPerCrit, weapon: false });

const SPECS = {
  // Feral: Cat and Bear form ignore the weapon's damage, so weapon = false.
  Druid:   { Feral: PHYS(2, 1, 20, false), Balance: CASTER(57) },
  Hunter:  { "Beast Mastery": PHYS(0, 2, 53), Marksmanship: PHYS(0, 2, 53), Survival: PHYS(0, 2, 53) },
  Mage:    { Arcane: CASTER(57), Fire: CASTER(57), Frost: CASTER(57) },
  Paladin: { Retribution: PHYS(2, 0, 20) },
  Priest:  { Shadow: CASTER(57) },
  Rogue:   { Assassination: PHYS(1, 1, 29), Combat: PHYS(1, 1, 29), Subtlety: PHYS(1, 1, 29) },
  Shaman:  { Elemental: CASTER(57), Enhancement: PHYS(2, 0, 20) },
  Warlock: { Affliction: CASTER(60), Demonology: CASTER(60), Destruction: CASTER(60) },
  Warrior: { Arms: PHYS(2, 0, 20), Fury: PHYS(2, 0, 20) },
};

// Starting values for the base weights (% DPS per +1%). You can edit them on the page.
//   Crit: physical crits add +100% damage, so +1% crit is about +1% DPS.
//         Spell crits add +50%, so about +0.5%.
//   Hit:  vs a boss you miss 9% (melee) or 16% (spells). Each 1% hit removes a
//         miss, about 1 / 0.91 = 1.1% (melee) or 1 / 0.84 = 1.2% (spells) more damage.
//         This only holds until you reach the hit cap.
//   Haste: +1% attack/cast speed is about +1% DPS.
//   Spell Damage: ESTIMATE, because it depends on your spells and your gear.
const BASE = {
  physical: { crit: 1.0, hit: 1.1, haste: 1.0, spell: 0 },
  caster:   { crit: 0.5, hit: 1.2, haste: 1.0, spell: 0.08 },
};

// The stats shown in the compare table.
// Stamina, Spirit and Armor don't add damage (weight 0), but they are shown
// so you can see every stat an item has after picking it in the search.
const STATS = ["Strength", "Agility", "Intellect", "Attack Power", "Spell Damage", "Hit %", "Crit %", "Haste %",
               "Weapon DPS", "Stamina", "Spirit", "Armor"];

const $ = (id) => document.getElementById(id);
const num = (id) => Number($(id).value) || 0; // empty box counts as 0

// Fill the class dropdown, starting on Druid.
for (const className in SPECS) $("class-select").add(new Option(className));
$("class-select").value = "Druid";

// Build the compare table: one row per stat.
STATS.forEach((stat, i) => {
  document.querySelector("#compare tbody").innerHTML +=
    `<tr><td>${stat}</td>
         <td><input id="old${i}" type="number" step="any" value="0"></td>
         <td><input id="new${i}" type="number" step="any" value="0"></td></tr>`;
});

const spec = () => SPECS[$("class-select").value][$("spec-select").value];

// When the class changes, refill the spec dropdown.
function fillSpecs() {
  $("spec-select").innerHTML = "";
  for (const specName in SPECS[$("class-select").value]) $("spec-select").add(new Option(specName));
  loadBaseWeights();
}

// Put the default base weights for this kind of spec into the boxes.
function loadBaseWeights() {
  const b = BASE[spec().kind];
  $("b-crit").value = b.crit;
  $("b-hit").value = b.hit;
  $("b-haste").value = b.haste;
  $("b-spell").value = b.spell;
  // The character-sheet DPS box only matters for physical specs.
  $("sheet-row").hidden = spec().kind !== "physical";
  // Feral Attack Power only counts for Feral, so refill the AP box of picked items.
  for (const side of ["old", "new"]) if (picked[side]) $(side + STATS.indexOf("Attack Power")).value = attackPowerFor(picked[side]);
  update();
}

// ---------------------------------------------------------------------------
// ITEM SEARCH: look items up on Wowhead instead of typing stats by hand.
// The page asks our local server (wow-items-mcp\web.js) at /api/search,
// which uses the same Wowhead code as the wow-items MCP connector.
// ---------------------------------------------------------------------------

// Which item stat (from the server) goes in which row of the compare table.
const ITEM_STAT = {
  "Strength": "strength", "Agility": "agility", "Intellect": "intellect",
  "Spell Damage": "spellDamage", "Hit %": "hitPercent", "Crit %": "critPercent", "Haste %": "hastePercent",
  "Stamina": "stamina", "Spirit": "spirit", "Armor": "armor",
};

// The item picked for each column ("old" = equipped, "new" = new item).
const picked = { old: null, new: null };

// "+N Attack Power in Cat, Bear..." only helps Feral druids, so add it just for them.
function attackPowerFor(item) {
  const feral = $("class-select").value === "Druid" && $("spec-select").value === "Feral";
  return item.stats.attackPower + (feral ? item.stats.feralAttackPower : 0);
}

// Put an item's stats into one column of the compare table.
function fillColumn(side, item) {
  picked[side] = item;
  STATS.forEach((stat, i) => {
    $(side + i).value =
      stat === "Attack Power" ? attackPowerFor(item)
      : stat === "Weapon DPS" ? item.stats.weapon?.dps ?? 0 // 0 for items that aren't weapons
      : item.stats[ITEM_STAT[stat]];
  });
  update();
}

// A short summary of the non-zero stats, shown under each search result.
function summary(s) {
  const parts = [
    [s.strength, "Str"], [s.agility, "Agi"], [s.stamina, "Sta"], [s.intellect, "Int"], [s.spirit, "Spi"],
    [s.attackPower, "AP"], [s.feralAttackPower, "Feral AP"], [s.spellDamage, "Spell Dmg"],
    [s.hitPercent, "% Hit"], [s.critPercent, "% Crit"], [s.hastePercent, "% Haste"], [s.armor, "Armor"],
  ].filter(([v]) => v).map(([v, label]) => `${label.startsWith("%") ? v : "+" + v} ${label}`);
  if (s.weapon?.dps) parts.push(`${s.weapon.dps} DPS`);
  return parts.join(", ") || "no stats";
}

// Show a message in a search box's "picked" line. textContent is used
// (not innerHTML) so item names can never inject HTML into the page.
function setNote(form, text) {
  form.querySelector(".picked").textContent = text;
}

// Run a search for one of the two forms.
async function search(side) {
  const form = $("search-" + side);
  const list = form.querySelector(".results");
  const query = form.querySelector("input").value.trim();
  if (!query) return;

  // Opened by double-click (file://)? Then there is no server to ask.
  if (location.protocol === "file:") {
    setNote(form, "Search needs the local server: run  node wow-items-mcp\\web.js  and open http://localhost:3000");
    return;
  }

  list.innerHTML = "";
  setNote(form, "Searching Wowhead…");
  try {
    const response = await fetch("/api/search?name=" + encodeURIComponent(query));
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Search failed");
    if (data.items.length === 0) return setNote(form, `No WoW Forever items found for "${query}".`);

    setNote(form, "Click an item to use its stats:");
    for (const item of data.items) {
      // One button per result: item name in its quality color, stats below.
      const button = document.createElement("button");
      button.type = "button";
      const name = document.createElement("span");
      name.className = "q-" + item.quality;
      name.textContent = item.name;
      const stats = document.createElement("span");
      stats.className = "note";
      stats.textContent = summary(item.stats);
      button.append(name, stats);
      button.addEventListener("click", () => {
        fillColumn(side, item);
        list.innerHTML = "";
        // Show which item is in use, with a link to its Wowhead page.
        const note = form.querySelector(".picked");
        note.textContent = "Using: ";
        const link = document.createElement("a");
        link.href = item.link;
        link.target = "_blank";
        link.textContent = item.name;
        note.append(link);
      });
      const li = document.createElement("li");
      li.append(button);
      list.append(li);
    }
  } catch (err) {
    setNote(form, "Search failed: " + err.message + " (is node wow-items-mcp\\web.js still running?)");
  }
}

// Pressing Enter in a search box submits its form: run the search instead of reloading.
for (const side of ["old", "new"]) {
  $("search-" + side).addEventListener("submit", (e) => { e.preventDefault(); search(side); });
}

// Work out every weight, show how, and compute the result.
function update() {
  const s = spec();
  const crit = num("b-crit"), hit = num("b-hit"), haste = num("b-haste"), spell = num("b-spell");

  // Attack Power: 14 AP = 1 DPS. As a % of your DPS, that's (1/14) / yourDPS x 100.
  const sheetDps = num("sheet-dps");
  const ap = s.kind === "physical" && sheetDps > 0 ? 100 / (14 * sheetDps) : 0;

  const fromCrit = (perCrit) => (perCrit ? crit / perCrit : 0);
  const weights = {
    "Strength":     s.strAP * ap,
    "Agility":      s.agiAP * ap + fromCrit(s.agiPerCrit),
    "Intellect":    fromCrit(s.intPerCrit),
    "Attack Power": ap,
    "Spell Damage": spell,
    "Hit %": hit, "Crit %": crit, "Haste %": haste,
    // Weapon DPS: +1 weapon DPS adds 1 DPS, the same as 14 Attack Power.
    "Weapon DPS":   s.weapon ? 14 * ap : 0,
    "Stamina": 0, "Spirit": 0, "Armor": 0, // survival stats: no DPS
  };

  // Explain each calculated weight in plain words.
  const how = {
    "Strength":     s.strAP ? `${s.strAP} AP each` : "no effect for this spec",
    "Agility":      [s.agiAP ? `${s.agiAP} AP` : "", s.agiPerCrit ? `1% crit per ${s.agiPerCrit}` : ""]
                      .filter(Boolean).join(" + ") || "no effect for this spec",
    "Intellect":    s.intPerCrit ? `1% spell crit per ${s.intPerCrit}` : "no damage effect",
    "Attack Power": s.kind === "physical" ? "14 AP = 1 DPS" : "not used by casters",
    "Weapon DPS":   s.weapon ? "+1 weapon DPS = +1 DPS (like 14 AP)"
                  : s.kind === "caster" ? "not used by casters" : "Cat/Bear form ignores weapon damage",
    "Stamina":      "no DPS (shown for info)",
    "Spirit":       "no DPS (shown for info)",
    "Armor":        "no DPS (shown for info)",
  };

  $("weights").innerHTML = STATS.map((stat) =>
    `<tr><td>${stat}</td><td>${weights[stat].toFixed(3)}%</td><td class="note">${how[stat] || "base weight (edit above)"}</td></tr>`
  ).join("");

  // Add up (new - old) x weight for every stat.
  let percent = 0;
  STATS.forEach((stat, i) => (percent += (num("new" + i) - num("old" + i)) * weights[stat]));

  const sign = percent >= 0 ? "+" : "";
  const result = $("result");
  result.className = percent >= 0 ? "upgrade" : "downgrade";
  result.textContent = `Estimated change: ${sign}${percent.toFixed(2)}% DPS`;
  if (s.kind === "physical" && !sheetDps) result.textContent += " (enter your character sheet DPS to count Str/Agi/AP)";
}

$("class-select").addEventListener("change", fillSpecs);
$("spec-select").addEventListener("change", loadBaseWeights);
// Re-calculate on every keystroke in a box (dropdowns are handled above).
document.addEventListener("input", (e) => { if (e.target.tagName === "INPUT") update(); });

fillSpecs(); // start up the page
