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
//
// Hit and Expertise caps vs raid bosses (community numbers from the WoW Forever
// character sheet; Blizzard hasn't published them, so they are editable on the page):
//   - Hit cap: 8% melee and ranged, 17% spells, 27% for dual-wield auto attacks
//   - Expertise cap: 6.5% removes the boss's dodge chance (attacking from behind)
//   https://conquestcapped.com/guides/wow-forever/wow-forever-hit-cap/
//   https://www.icy-veins.com/wow-forever/feral-druid-melee-dps-and-tank-pve-stat-priority

// One entry per damage spec.
//   kind:       "physical" (uses Attack Power) or "caster" (uses Spell Damage)
//   strAP:      Attack Power per Strength
//   agiAP:      Attack Power per Agility
//   agiPerCrit: Agility needed for +1% crit (0 = Agility gives no crit)
//   intPerCrit: Intellect needed for +1% spell crit (0 = not used)
//   weapon:     true if the weapon's own damage (Weapon DPS) matters for this spec
//   critBonus:  extra damage a crit does, in % (100 = double damage). Talents change it.
//   critWhy:    where the critBonus number comes from (shown on the page)
// Healer and tank specs are left out because this tool measures damage.
const PHYS = (strAP, agiAP, agiPerCrit, weapon = true) =>
  ({ kind: "physical", strAP, agiAP, agiPerCrit, intPerCrit: 0, weapon,
     critBonus: 100, critWhy: "physical crits do double damage" });
// Change a spec's crit bonus because of a talent, e.g. talent(PHYS(...), 120, "Impale").
// WoW Forever talent numbers from community guides (beta-era; edit on the page if they change):
//   Impale +20% (Arms), Lethality +20% (Rogue), Predatory Strikes +20% (Feral),
//   Ice Shards +20% (Frost), Ignite +40% of the crit as a burn (Fire),
//   Shadowform doubles Shadow crit bonus (Shadow Priest)
//   https://maxroll.gg/wow-forever/news/wow-forever-class-deep-dives-whats-changing-for-all-nine-classes
//   https://www.icy-veins.com/wow-forever/mage-talent-calculator
//   https://foreverdb.net/class/Warrior/talents
const talent = (s, critBonus, critWhy) => ({ ...s, critBonus, critWhy });
// Only Paladin (54) and Warlock (60) are named in the source; 57 is a middle guess for the others.
//   schools:    the spell schools a caster spec mostly casts. Items with
//               "damage done by Fire spells" only count for specs that cast Fire.
const CASTER = (intPerCrit, schools) =>
  ({ kind: "caster", strAP: 0, agiAP: 0, agiPerCrit: 0, intPerCrit, weapon: false, schools,
     critBonus: 50, critWhy: "spell crits do +50% damage" });

const SPECS = {
  // Feral: unlike Classic, WoW Forever's Cat and Bear form DO use the weapon's DPS
  // (swing speed is fixed by the form, so only the weapon's DPS matters).
  // Source: https://www.icy-veins.com/wow-forever/feral-druid-melee-dps-and-tank-pve-stat-priority
  Druid:   { Feral: talent(PHYS(2, 1, 20), 120, "100% + 20% from Predatory Strikes"),
             Balance: CASTER(57, ["arcane", "nature"]) },
  Hunter:  { "Beast Mastery": PHYS(0, 2, 53), Marksmanship: PHYS(0, 2, 53), Survival: PHYS(0, 2, 53) },
  Mage:    { Arcane: CASTER(57, ["arcane"]),
             Fire: talent(CASTER(57, ["fire"]), 90, "50% + 40% from Ignite's burn"),
             Frost: talent(CASTER(57, ["frost"]), 70, "50% + 20% from Ice Shards") },
  Paladin: { Retribution: PHYS(2, 0, 20) },
  Priest:  { Shadow: talent(CASTER(57, ["shadow"]), 100, "Shadowform doubles the 50%") },
  Rogue:   { Assassination: talent(PHYS(1, 1, 29), 120, "100% + 20% from Lethality"),
             Combat: PHYS(1, 1, 29), Subtlety: PHYS(1, 1, 29) },
  Shaman:  { Elemental: CASTER(57, ["nature", "fire"]), Enhancement: PHYS(2, 0, 20) },
  Warlock: { Affliction: CASTER(60, ["shadow"]), Demonology: CASTER(60, ["shadow"]),
             Destruction: CASTER(60, ["shadow", "fire"]) },
  Warrior: { Arms: talent(PHYS(2, 0, 20), 120, "100% + 20% from Impale"), Fury: PHYS(2, 0, 20) },
};

// Starting values for the base weights (% DPS per +1%). You can edit them on the page.
//   Crit: calculated, not a base weight. A crit adds "critBonus" extra damage
//         (100% physical, 50% spells, more with talents). +1% crit gives
//         bonus / (1 + bonus x your crit) more DPS, e.g. 1.0 / (1 + 1.0 x 0.25) = 0.8%
//         at 25% crit: the more crit you have, the less each extra 1% adds.
//   Hit:  vs a boss you miss 8% (melee) or 17% (spells). Each 1% hit removes a
//         miss, about 1 / 0.92 = 1.1% (melee) or 1 / 0.83 = 1.2% (spells) more damage.
//         This only holds until you reach the hit cap.
//   Expertise uses the hit weight: a dodged attack does no damage, just like a miss.
//   Haste: +1% attack/cast speed is about +1% DPS.
//   Spell Damage: ESTIMATE, because it depends on your spells and your gear.
const BASE = {
  physical: { hit: 1.1, haste: 1.0, spell: 0 },
  caster:   { hit: 1.2, haste: 1.0, spell: 0.08 },
};

// Default caps (editable on the page).
const CAPS = {
  physical: { hit: 8, expertise: 6.5 },
  caster:   { hit: 17, expertise: 0 },
};
// Dual wielding: auto attacks miss much more, so hit keeps helping them up to 27%.
// Past the normal cap only auto attacks benefit, which we estimate as half your damage.
const DUAL_WIELD_HIT_CAP = 27;
const DUAL_WIELD_AUTO_SHARE = 0.5;
// Specs that can dual wield, and whether the checkbox starts ticked.
const DUAL_WIELD_SPECS = {
  "Rogue/Assassination": true, "Rogue/Combat": true, "Rogue/Subtlety": true,
  "Warrior/Fury": true, "Warrior/Arms": false, "Shaman/Enhancement": false,
};

const clamp = (x, low, high) => Math.min(high, Math.max(low, x));

// The stats shown in the compare table.
// Stamina, Spirit and Armor don't add damage (weight 0), but they are shown
// so you can see every stat an item has after picking it in the search.
const STATS = ["Strength", "Agility", "Intellect", "Attack Power", "Spell Damage", "Hit %", "Crit %", "Haste %",
               "Weapon DPS", "Expertise %", "Spell Penetration", "Stamina", "Spirit", "Armor"];

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
         <td><input id="new${i}" type="number" step="any" value="0"></td>
         <td class="num effect" id="eff${i}"></td></tr>`;
});

// Class colors (the colors WoW players know each class by), used as the page's accent.
const CLASS_COLORS = {
  Druid: "#ff7c0a", Hunter: "#aad372", Mage: "#3fc7eb", Paladin: "#f48cba", Priest: "#f0f0f0",
  Rogue: "#fff468", Shaman: "#2f8cf0", Warlock: "#8788ee", Warrior: "#c69b6d",
};

const spec = () => SPECS[$("class-select").value][$("spec-select").value];

// When the class changes, refill the spec dropdown.
function fillSpecs() {
  $("spec-select").innerHTML = "";
  for (const specName in SPECS[$("class-select").value]) $("spec-select").add(new Option(specName));
  document.documentElement.style.setProperty("--class", CLASS_COLORS[$("class-select").value]);
  loadBaseWeights();
}

// Put the default base weights for this kind of spec into the boxes.
function loadBaseWeights() {
  const b = BASE[spec().kind];
  $("crit-bonus").value = spec().critBonus;
  $("b-hit").value = b.hit;
  $("b-haste").value = b.haste;
  $("b-spell").value = b.spell;
  // The character-sheet DPS box and Expertise only matter for physical specs.
  const physical = spec().kind === "physical";
  $("sheet-row").hidden = !physical;
  $("cur-exp-row").hidden = !physical;
  $("exp-cap-row").hidden = !physical;
  $("hit-cap").value = CAPS[spec().kind].hit;
  $("exp-cap").value = CAPS[spec().kind].expertise;
  // Show the dual-wield checkbox only for specs that can dual wield.
  const dwKey = $("class-select").value + "/" + $("spec-select").value;
  $("dw-row").hidden = !(dwKey in DUAL_WIELD_SPECS);
  $("dual-wield").checked = DUAL_WIELD_SPECS[dwKey] === true;
  refreshItems();
}

// Some boxes depend on your spec or weapon setup, not just the item (Feral AP,
// school spell damage, weapon DPS), so refill both columns from the picked items.
function refreshItems() {
  applyDualWieldLayout();
  fillColumn("old");
  fillColumn("new");
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
  "Haste %": "hastePercent", // Hit % and Crit % depend on the spec (see hitFor / critFor)
  "Expertise %": "expertisePercent", "Spell Penetration": "spellPenetration",
  "Stamina": "stamina", "Spirit": "spirit", "Armor": "armor",
};

// The items picked for each column ("old" = equipped, "new" = new item).
// "main" is the normal search box; "off" is the off-hand box shown when dual wielding.
const picked = { old: { main: null, off: null }, new: { main: null, off: null } };
const picker = (side, slot) => $(`pick-${side}-${slot}`);

// "+N Attack Power in Cat, Bear..." only helps Feral druids, so add it just for them.
function attackPowerFor(item) {
  const feral = $("class-select").value === "Druid" && $("spec-select").value === "Feral";
  return item.stats.attackPower + (feral ? item.stats.feralAttackPower : 0);
}

// Hit and crit: "...with spells" versions only help casters.
const isCaster = () => spec().kind === "caster";
const hitFor = (item) => item.stats.hitPercent + (isCaster() ? item.stats.spellHitPercent || 0 : 0);
const critFor = (item) => item.stats.critPercent + (isCaster() ? item.stats.spellCritPercent || 0 : 0);

// Spell damage for all schools, plus the best single-school bonus this spec can use.
// Example: "+34 Fire and +34 Shadow" counts 34 for a Destruction Warlock (not 68),
// because each spell is only one school.
function spellDamageFor(item) {
  const schools = spec().schools || [];
  const school = item.stats.schoolSpellDamage || {};
  return item.stats.spellDamage + Math.max(0, ...schools.map((name) => school[name] || 0));
}

// Weapon DPS that actually counts for your spec:
//   - Hunters: only ranged weapons (bow, gun, crossbow). Their melee weapon barely matters.
//   - Everyone else: melee weapons only (a bow or wand on a Warrior doesn't count).
//   - Off-hand weapons hit for half damage, so they count at half DPS.
const OFF_HAND_SHARE = 0.5;
const isDualWielding = () => !$("dw-row").hidden && $("dual-wield").checked;

// How much of an item's weapon DPS counts, and a note explaining why.
//   hand: "main" or "off" (which search box the item is in)
//   twoHanderInMain: true if the main hand already holds a two-handed weapon
function weaponDpsFor(item, hand, twoHanderInMain) {
  const w = item.stats.weapon;
  if (!w?.dps) return { dps: 0, note: "" };

  const ranged = w.slot === "Ranged" || w.slot === "Thrown";
  if ($("class-select").value === "Hunter") {
    return ranged ? { dps: w.dps, note: "" }
      : { dps: 0, note: "Melee weapon: Hunters' damage comes from their ranged weapon, so its DPS isn't counted." };
  }
  if (ranged) return { dps: 0, note: "Ranged weapon: only Hunters get damage from this, so its DPS isn't counted." };

  if (hand === "main") {
    if (w.slot === "Off Hand") return { dps: 0, note: "This weapon only fits in the off hand, so it isn't counted here." };
    if (w.slot === "Two-Hand" && isDualWielding())
      return { dps: w.dps, note: "Two-handed: leave the off hand empty to compare it with a dual-wield pair." };
    return { dps: w.dps, note: "" };
  }

  // Off hand: only shown when dual wielding.
  if (twoHanderInMain) return { dps: 0, note: "Your main hand is two-handed, so the off hand isn't used." };
  if (w.slot === "Two-Hand") return { dps: 0, note: "Two-handed weapons can't go in the off hand." };
  if (w.slot === "Main Hand") return { dps: 0, note: "This weapon only fits in the main hand, so it isn't counted here." };
  return { dps: Math.round(w.dps * OFF_HAND_SHARE * 100) / 100, note: `Off hand: counts half of its ${w.dps} DPS.` };
}

// Fill one column of the compare table from its picked item(s).
// With dual wield on, the main-hand and off-hand weapons are added together.
function fillColumn(side) {
  const main = picked[side].main;
  const off = isDualWielding() ? picked[side].off : null;
  if (!main && !off) return; // nothing picked: keep whatever was typed by hand

  const twoHanderInMain = main?.stats.weapon?.slot === "Two-Hand";
  const weapons = {};
  for (const [hand, item] of [["main", main], ["off", off]]) {
    weapons[hand] = item ? weaponDpsFor(item, hand, twoHanderInMain) : { dps: 0, note: "" };
    picker(side, hand).querySelector(".weapon-note").textContent = weapons[hand].note;
  }

  // An off-hand weapon that can't be used (e.g. next to a two-hander) adds no stats either.
  const offUsable = off && !(twoHanderInMain || ["Two-Hand", "Main Hand"].includes(off.stats.weapon?.slot));
  const items = [main, offUsable ? off : null].filter(Boolean);

  STATS.forEach((stat, i) => {
    let value;
    if (stat === "Weapon DPS") value = weapons.main.dps + weapons.off.dps;
    else {
      value = items.reduce((sum, item) =>
        sum + (stat === "Attack Power" ? attackPowerFor(item)
             : stat === "Spell Damage" ? spellDamageFor(item)
             : stat === "Hit %" ? hitFor(item)
             : stat === "Crit %" ? critFor(item)
             : item.stats[ITEM_STAT[stat]]), 0);
    }
    $(side + i).value = Math.round(value * 100) / 100;
  });
}

// When dual wield is on, show the off-hand boxes and the swap/copy buttons,
// and rename the first box to "main hand".
const SLOT_LABELS = {
  old: { single: "Find equipped item", main: "Equipped main hand" },
  new: { single: "Find new item", main: "New main hand" },
};
function applyDualWieldLayout() {
  const dw = isDualWielding();
  for (const side of ["old", "new"]) {
    picker(side, "off").hidden = !dw;
    picker(side, "main").closest(".item-search").querySelector(".dw-tools").hidden = !dw;
    picker(side, "main").querySelector(".slot-label").textContent = dw ? SLOT_LABELS[side].main : SLOT_LABELS[side].single;
    if (!dw) picker(side, "off").querySelector(".weapon-note").textContent = "";
  }
}

// Show "Using: <item>" (with a Wowhead link) under a search box, or clear it.
function showPicked(side, slot) {
  const note = picker(side, slot).querySelector(".picked");
  const item = picked[side][slot];
  // Keep the search text in step with the item (matters after Swap or Copy).
  picker(side, slot).querySelector("input").value = item ? item.name : "";
  note.textContent = item ? "Using: " : "";
  if (!item) return;
  const link = document.createElement("a");
  link.href = item.link;
  link.target = "_blank";
  link.textContent = item.name;
  note.append(link);
}

// A short summary of the non-zero stats, shown under each search result.
function summary(s) {
  const parts = [
    [s.strength, "Str"], [s.agility, "Agi"], [s.stamina, "Sta"], [s.intellect, "Int"], [s.spirit, "Spi"],
    [s.attackPower, "AP"], [s.feralAttackPower, "Feral AP"], [s.spellDamage, "Spell Dmg"],
    // One entry per school, e.g. "+34 Fire Dmg"
    ...Object.entries(s.schoolSpellDamage || {}).map(([name, v]) => [v, name[0].toUpperCase() + name.slice(1) + " Dmg"]),
    [s.healing, "Healing"], [s.spellPenetration, "Spell Pen"],
    [s.hitPercent, "% Hit"], [s.critPercent, "% Crit"],
    [s.spellHitPercent, "% Spell Hit"], [s.spellCritPercent, "% Spell Crit"], [s.hastePercent, "% Haste"],
    [s.expertisePercent, "% Expertise"], [s.armor, "Armor"],
  ].filter(([v]) => v).map(([v, label]) => `${label.startsWith("%") ? v : "+" + v} ${label}`);
  if (s.weapon?.dps) parts.push(`${s.weapon.dps} DPS`);
  return parts.join(", ") || "no stats";
}

// Show a message in a search box's "picked" line. textContent is used
// (not innerHTML) so item names can never inject HTML into the page.
function setNote(form, text) {
  form.querySelector(".picked").textContent = text;
}

// Run a search in one search box (side = "old"/"new", slot = "main"/"off").
async function search(side, slot) {
  const form = picker(side, slot);
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
        picked[side][slot] = item;
        list.innerHTML = "";
        showPicked(side, slot); // "Using: <item>" with a Wowhead link
        fillColumn(side);
        update();
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
  for (const slot of ["main", "off"]) {
    picker(side, slot).addEventListener("submit", (e) => { e.preventDefault(); search(side, slot); });
  }
}

// "⇄ Swap hands": the main-hand weapon goes to the off hand and the other way round.
for (const side of ["old", "new"]) {
  $("swap-" + side).addEventListener("click", () => {
    const p = picked[side];
    [p.main, p.off] = [p.off, p.main];
    showPicked(side, "main");
    showPicked(side, "off");
    refreshItems();
  });
}

// "Copy equipped weapons": start the New column from your current pair, so you
// can change just one weapon (or swap hands) and see the difference.
$("copy-old").addEventListener("click", () => {
  if (!picked.old.main && !picked.old.off) return; // nothing equipped picked yet
  picked.new.main = picked.old.main;
  picked.new.off = picked.old.off;
  showPicked("new", "main");
  showPicked("new", "off");
  refreshItems();
});

// Work out every weight, show how, and compute the result.
function update() {
  const s = spec();
  const hit = num("b-hit"), haste = num("b-haste"), spell = num("b-spell");

  // Crit weight: bonus / (1 + bonus x current crit), both as fractions, then x 100 for %.
  // (Talents that raise crit damage make crit worth more; having lots of crit already
  // makes each extra 1% worth a bit less.)
  const critBonus = num("crit-bonus") / 100, curCrit = num("cur-crit") / 100;
  const crit = critBonus / (1 + critBonus * curCrit);

  // Attack Power: 14 AP = 1 DPS. As a % of your DPS, that's (1/14) / yourDPS x 100.
  const sheetDps = num("sheet-dps");
  const ap = s.kind === "physical" && sheetDps > 0 ? 100 / (14 * sheetDps) : 0;

  const fromCrit = (perCrit) => (perCrit ? crit / perCrit : 0);

  // --- Hit and Expertise with caps ---
  // "Useful hit" for a given hit %: full value up to the cap, then (dual wield only)
  // half value up to 27%, then nothing.
  const physical = s.kind === "physical";
  const hitCap = num("hit-cap"), curHit = num("cur-hit");
  const dualWield = !$("dw-row").hidden && $("dual-wield").checked;
  const usefulHit = (h) => clamp(h, 0, hitCap) +
    (dualWield ? DUAL_WIELD_AUTO_SHARE * clamp(h - hitCap, 0, DUAL_WIELD_HIT_CAP - hitCap) : 0);
  // Expertise: full value until the boss's dodge chance is gone. Casters don't use it.
  const expCap = physical ? num("exp-cap") : 0, curExp = num("cur-exp");
  const usefulExp = (e) => clamp(e, 0, expCap);
  const expWeight = physical ? hit : 0; // a dodge is worth the same as a miss

  // The weight shown in the table = what +1% would give you right now.
  const hitNow = curHit < hitCap ? hit
               : dualWield && curHit < DUAL_WIELD_HIT_CAP ? hit * DUAL_WIELD_AUTO_SHARE : 0;
  const expNow = curExp < expCap ? expWeight : 0;

  const weights = {
    "Strength":     s.strAP * ap,
    "Agility":      s.agiAP * ap + fromCrit(s.agiPerCrit),
    "Intellect":    fromCrit(s.intPerCrit),
    "Attack Power": ap,
    "Spell Damage": spell,
    "Hit %": hitNow, "Crit %": crit, "Haste %": haste,
    // Weapon DPS: +1 weapon DPS adds 1 DPS, the same as 14 Attack Power.
    "Weapon DPS":   s.weapon ? 14 * ap : 0,
    "Expertise %":  expNow,
    "Spell Penetration": 0, // read from items, but not counted yet
    "Stamina": 0, "Spirit": 0, "Armor": 0, // survival stats: no DPS
  };

  // Explain each calculated weight in plain words.
  const how = {
    "Strength":     s.strAP ? `${s.strAP} AP each` : "no effect for this spec",
    "Agility":      [s.agiAP ? `${s.agiAP} AP` : "", s.agiPerCrit ? `1% crit per ${s.agiPerCrit}` : ""]
                      .filter(Boolean).join(" + ") || "no effect for this spec",
    "Intellect":    s.intPerCrit ? `1% spell crit per ${s.intPerCrit}` : "no damage effect",
    "Attack Power": s.kind === "physical" ? "14 AP = 1 DPS" : "not used by casters",
    "Weapon DPS":   s.weapon ? "+1 weapon DPS = +1 DPS (like 14 AP)" : "not used by casters",
    "Hit %":        curHit < hitCap ? `full value until the ${hitCap}% cap (you have ${curHit}%)`
                  : hitNow ? `past ${hitCap}%: only dual-wield auto attacks gain, until ${DUAL_WIELD_HIT_CAP}%`
                  : `you're at the cap: no more value`,
    "Expertise %":  !physical ? "not used by casters"
                  : curExp < expCap ? `same as hit until the ${expCap}% dodge cap (you have ${curExp}%)`
                  : "you're at the cap: no more value",
    "Crit %":       `crits do +${num("crit-bonus")}% damage` +
                    (num("crit-bonus") === s.critBonus ? ` (${s.critWhy})` : " (your value)") +
                    `; you have ${num("cur-crit")}% crit`,
    "Spell Penetration": "shown, not in the estimate yet",
    "Stamina":      "no DPS (shown for info)",
    "Spirit":       "no DPS (shown for info)",
    "Armor":        "no DPS (shown for info)",
  };

  $("weights").innerHTML = STATS.map((stat) =>
    `<tr><td>${stat}</td><td>${weights[stat].toFixed(3)}%</td><td class="note">${how[stat] || "base weight (edit above)"}</td></tr>`
  ).join("");

  // Add up (new - old) x weight for every stat.
  // Hit and Expertise are different: swapping items moves you along the cap, so we
  // compare your useful hit before and after the swap. Your current hit already
  // includes the equipped item, so it's at least that item's hit.
  const capped = {
    "Hit %":       { useful: usefulHit, now: curHit, weight: hit },
    "Expertise %": { useful: usefulExp, now: curExp, weight: expWeight },
  };
  let percent = 0;
  STATS.forEach((stat, i) => {
    const oldValue = num("old" + i), newValue = num("new" + i);
    const c = capped[stat];
    let change;
    if (c) {
      const before = Math.max(c.now, oldValue);
      const after = before - oldValue + newValue;
      change = (c.useful(after) - c.useful(before)) * c.weight;
    } else {
      change = (newValue - oldValue) * weights[stat];
    }
    percent += change;

    // Show each stat's share of the result in the "DPS effect" column,
    // and fade rows that are 0 on both sides.
    const cell = $("eff" + i);
    const rounded = Math.round(change * 100) / 100;
    cell.textContent = rounded ? formatPercent(rounded) : "—";
    cell.className = "num effect" + (rounded > 0 ? " up" : rounded < 0 ? " down" : "");
    cell.closest("tr").classList.toggle("empty", !oldValue && !newValue);
  });

  const value = $("result-value");
  const rounded = Math.round(percent * 100) / 100;
  value.textContent = formatPercent(rounded);
  value.className = "result-value" + (rounded > 0 ? " upgrade" : rounded < 0 ? " downgrade" : "");
  $("result-note").textContent = s.kind === "physical" && !sheetDps
    ? "Enter your character sheet DPS to count Strength, Agility and Attack Power." : "";
}

// "+1.23%" / "−0.50%" (a real minus sign looks better than a hyphen)
function formatPercent(x) {
  return (x > 0 ? "+" : x < 0 ? "−" : "+") + Math.abs(x).toFixed(2) + "%";
}

$("class-select").addEventListener("change", fillSpecs);
$("spec-select").addEventListener("change", loadBaseWeights);
// Re-calculate on every keystroke in a box (dropdowns are handled above).
document.addEventListener("input", (e) => { if (e.target.tagName === "INPUT") update(); });
// Ticking "I dual wield" shows or hides the off-hand boxes and recounts both columns.
$("dual-wield").addEventListener("change", refreshItems);

fillSpecs(); // start up the page
