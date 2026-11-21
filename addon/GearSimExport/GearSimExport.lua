-- GearSimExport.lua (version 0.2.0)
--
-- Exports your character's gear and stats as one line of text, which you
-- copy and paste into the Gear DPS Simulator website.
--
-- In the game:
--   /gearsim        open the export window (then press Ctrl+C to copy)
--   /gearsim test   print a report of which game functions exist (for fixing problems)
--
-- Lua basics used here:
--   local x = ...       a variable that only this file can see
--   function(...) end   a block of code you can run later
--   -- text            a comment (the game ignores it)
--   pcall(fn, ...)      "protected call": runs fn, and if it fails we get the error
--                       instead of the addon crashing

local GOLD = "|cffc9a961"  -- "|cffRRGGBB" starts a color in chat, "|r" ends it
local GREEN = "|cff57d17a"
local RED = "|cfff06464"

local function say(text)
  print(GOLD .. "GearSim:|r " .. text)
end

-- ---------------------------------------------------------------------------
-- 1. Small helpers
-- ---------------------------------------------------------------------------

-- Call a game function safely. Returns all its results, or nothing if it is
-- missing or fails, so one problem never breaks the whole export.
local function safe(fn, ...)
  if type(fn) ~= "function" then return end
  local results = { pcall(fn, ...) }
  if not results[1] then return end
  return select(2, unpack(results))
end

-- Format a number for the export: at most 2 decimals, no trailing zeros.
-- 12.50 -> "12.5", 100.00 -> "100", nil -> "0"
local function n(x)
  if type(x) ~= "number" then return "0" end
  local text = string.format("%.2f", x):gsub("%.?0+$", "")
  if text == "" or text == "-" then text = "0" end
  return text
end

-- The best value over the six magic schools (2 = Holy ... 7 = Arcane).
local function bestOverSchools(fn)
  local best = 0
  for school = 2, 7 do
    local value = safe(fn, school)
    if type(value) == "number" and value > best then best = value end
  end
  return best
end

-- ---------------------------------------------------------------------------
-- 2. Read your stats
-- ---------------------------------------------------------------------------
local function readStats()
  local s = {}

  -- Strength, Agility, Stamina, Intellect, Spirit (UnitStat returns base, total, ...)
  for i = 1, 5 do
    local _, total = safe(UnitStat, "player", i)
    s[i] = total
  end

  -- Attack power = base + buffs + debuffs
  local base, plus, minus = safe(UnitAttackPower, "player")
  s.ap = (base or 0) + (plus or 0) + (minus or 0)
  base, plus, minus = safe(UnitRangedAttackPower, "player")
  s.rap = (base or 0) + (plus or 0) + (minus or 0)

  -- Character sheet DPS = average hit / swing time
  local low, high, offLow, offHigh = safe(UnitDamage, "player")
  local mainSpeed, offSpeed = safe(UnitAttackSpeed, "player")
  s.mhDps = (low and mainSpeed and mainSpeed > 0) and (low + high) / 2 / mainSpeed or 0
  s.ohDps = (offLow and offSpeed and offSpeed > 0) and (offLow + offHigh) / 2 / offSpeed or 0
  local rangedSpeed, rangedLow, rangedHigh = safe(UnitRangedDamage, "player")
  s.rDps = (rangedLow and rangedSpeed and rangedSpeed > 0) and (rangedLow + rangedHigh) / 2 / rangedSpeed or 0

  -- Crit, hit and expertise (percentages)
  s.crit = safe(GetCritChance) or 0
  s.rangedCrit = safe(GetRangedCritChance) or 0
  s.spellCrit = bestOverSchools(GetSpellCritChance)
  s.hit = safe(GetHitModifier) or 0
  s.spellHit = safe(GetSpellHitModifier) or 0
  s.expertise = safe(GetExpertise) or 0

  -- Spell damage (the best school)
  s.spellDamage = bestOverSchools(GetSpellBonusDamage)
  return s
end

-- ---------------------------------------------------------------------------
-- 3. Read your gear
-- ---------------------------------------------------------------------------
-- Slot numbers the game uses: 1 head, 2 neck, 3 shoulders, 15 back, 5 chest,
-- 9 wrists, 10 hands, 6 waist, 7 legs, 8 feet, 11-12 rings, 13-14 trinkets,
-- 16 main hand, 17 off hand, 18 ranged/relic.
local SLOTS = { 1, 2, 3, 15, 5, 9, 10, 6, 7, 8, 11, 12, 13, 14, 16, 17, 18 }

-- An item link contains "item:ID:enchant:gem1:gem2:gem3:gem4:suffix:unique:
-- level:spec:modifiers:context:numBonuses:bonus1:bonus2:...".
-- Example: item:7413::::::::43:1484:::1:12726  (12726 = "of the Wolf")
local function readItem(slot)
  local link = safe(GetInventoryItemLink, "player", slot)
  if not link then return nil end
  local itemString = link:match("item:([%-%d:]*)")
  if not itemString then return nil end

  -- Split on ":" but keep empty fields, so the positions stay right.
  local parts = {}
  for field in (itemString .. ":"):gmatch("([^:]*):") do parts[#parts + 1] = field end

  local bonuses = {}
  local count = tonumber(parts[13]) or 0
  for i = 1, count do
    if parts[13 + i] and parts[13 + i] ~= "" then bonuses[#bonuses + 1] = parts[13 + i] end
  end

  -- "slot:itemID:enchant:suffix:bonus.bonus"
  return table.concat({ slot, parts[1] or "", parts[2] or "", parts[7] or "", table.concat(bonuses, ".") }, ":")
end

-- ---------------------------------------------------------------------------
-- 4. Build the export line
-- ---------------------------------------------------------------------------
-- Format (version GS1), sections separated by "|":
--   GS1 | CLASS | level
--   | str,agi,sta,int,spi
--   | ap,rangedAp
--   | mainHandDps,offHandDps,rangedDps
--   | crit,rangedCrit,spellCrit
--   | hit,spellHit
--   | expertise
--   | spellDamage
--   | slot:item:enchant:suffix:bonuses;slot:...
-- The website reads this format, so change both together if it ever changes.
local function buildExport()
  local s = readStats()
  local _, classFile = safe(UnitClass, "player") -- e.g. "DRUID"

  local items = {}
  for _, slot in ipairs(SLOTS) do
    local item = readItem(slot)
    if item then items[#items + 1] = item end
  end

  local line = table.concat({
    "GS1",
    classFile or "UNKNOWN",
    n(safe(UnitLevel, "player")),
    table.concat({ n(s[1]), n(s[2]), n(s[3]), n(s[4]), n(s[5]) }, ","),
    n(s.ap) .. "," .. n(s.rap),
    table.concat({ n(s.mhDps), n(s.ohDps), n(s.rDps) }, ","),
    table.concat({ n(s.crit), n(s.rangedCrit), n(s.spellCrit) }, ","),
    n(s.hit) .. "," .. n(s.spellHit),
    n(s.expertise),
    n(s.spellDamage),
    table.concat(items, ";"),
  }, "|")
  return line, s, #items
end

-- ---------------------------------------------------------------------------
-- 5. The export window
-- ---------------------------------------------------------------------------
local window

local function createWindow()
  -- Try the game's standard window frame. If this game version doesn't have
  -- that template, fall back to a plain dark box.
  local ok, frame = pcall(CreateFrame, "Frame", "GearSimExportFrame", UIParent, "BasicFrameTemplateWithInset")
  if not ok or not frame then
    frame = CreateFrame("Frame", "GearSimExportFrame", UIParent)
    local bg = frame:CreateTexture(nil, "BACKGROUND")
    bg:SetAllPoints()
    bg:SetColorTexture(0.04, 0.05, 0.07, 0.92)
  end
  frame:SetSize(540, 116)
  frame:SetPoint("CENTER", 0, 120)
  frame:SetFrameStrata("DIALOG")
  -- Drag the window with the mouse
  frame:SetMovable(true)
  frame:EnableMouse(true)
  frame:RegisterForDrag("LeftButton")
  frame:SetScript("OnDragStart", frame.StartMoving)
  frame:SetScript("OnDragStop", frame.StopMovingOrSizing)

  local title = frame:CreateFontString(nil, "OVERLAY", "GameFontHighlight")
  title:SetPoint("TOP", 0, -5)
  title:SetText("GearSim Export")

  local hint = frame:CreateFontString(nil, "OVERLAY", "GameFontNormalSmall")
  hint:SetPoint("TOPLEFT", 18, -34)
  hint:SetText("Press Ctrl+C to copy, then paste it into the website's Import box. Esc closes.")

  -- One-line text box holding the export. Typing in it does nothing
  -- (it puts the text back), so you can't break it by accident.
  local box = CreateFrame("EditBox", nil, frame, "InputBoxTemplate")
  box:SetSize(500, 24)
  box:SetPoint("TOPLEFT", 22, -58)
  box:SetAutoFocus(false)
  box:SetMaxLetters(0) -- 0 = no length limit
  box:SetScript("OnEscapePressed", function() frame:Hide() end)
  box:SetScript("OnTextChanged", function(self, userInput)
    if userInput then self:SetText(frame.exportText or ""); self:HighlightText() end
  end)
  box:SetScript("OnEditFocusGained", function(self) self:HighlightText() end)
  frame.box = box

  local note = frame:CreateFontString(nil, "OVERLAY", "GameFontDisableSmall")
  note:SetPoint("TOPLEFT", 18, -88)
  frame.note = note

  -- Escape closes the window, like other game windows
  table.insert(UISpecialFrames, "GearSimExportFrame")
  return frame
end

local function showExport()
  local ok, line, stats, itemCount = pcall(buildExport)
  if not ok then
    say(RED .. "export failed: " .. tostring(line) .. "|r  (try /gearsim test and tell Claude)")
    return
  end
  window = window or createWindow()
  window.exportText = line
  window.note:SetText(itemCount .. " items, " .. #line .. " characters")
  window:Show()
  window.box:SetText(line)
  window.box:SetFocus()
  window.box:HighlightText()

  -- A short summary in chat, so you can check the numbers look right
  say(string.format("exported %d items. AP %s, crit %s%%, hit %s%%, spell crit %s%%, sheet DPS %s.",
    itemCount, n(stats.ap), n(stats.crit), n(stats.hit), n(stats.spellCrit), n(stats.mhDps)))
end

-- ---------------------------------------------------------------------------
-- 6. The test report (/gearsim test), kept for fixing problems later
-- ---------------------------------------------------------------------------
local NEEDED = {
  "GetInventoryItemLink", "UnitStat", "UnitAttackPower", "UnitRangedAttackPower",
  "UnitDamage", "UnitAttackSpeed", "UnitRangedDamage", "GetCritChance", "GetRangedCritChance",
  "GetSpellCritChance", "GetHitModifier", "GetSpellHitModifier", "GetExpertise",
  "GetSpellBonusDamage", "UnitClass", "UnitLevel",
}

local function runTest()
  local version, build, _, interface = GetBuildInfo()
  say("test report. Game " .. tostring(version) .. " (build " .. tostring(build) ..
      ", interface " .. tostring(interface) .. ")")
  local missing = 0
  for _, name in ipairs(NEEDED) do
    if _G[name] then
      print("   " .. GREEN .. "yes|r  " .. name)
    else
      print("   " .. RED .. "NO|r   " .. name)
      missing = missing + 1
    end
  end
  local ok, line = pcall(buildExport)
  say("export test: " .. (ok and (GREEN .. "works|r (" .. #line .. " characters)") or (RED .. tostring(line) .. "|r")))
  say(missing == 0 and (GREEN .. "all functions found.|r") or (missing .. " function(s) missing."))
end

-- ---------------------------------------------------------------------------
-- 7. Login message and the /gearsim command
-- ---------------------------------------------------------------------------
local events = CreateFrame("Frame")
events:RegisterEvent("PLAYER_LOGIN")
events:SetScript("OnEvent", function()
  say("loaded. Type /gearsim to export your gear.")
end)

SLASH_GEARSIM1 = "/gearsim"
SlashCmdList.GEARSIM = function(message)
  if (message or ""):lower():find("test") then
    runTest()
  else
    showExport()
  end
end
