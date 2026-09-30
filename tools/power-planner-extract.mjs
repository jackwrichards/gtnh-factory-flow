#!/usr/bin/env node
/**
 * Extracts the power-sector data tables from the community "GTNH Power
 * Planner" spreadsheet (by Fox) into JSON the app imports. Source of truth
 * for the power cards; the decoded model is docs/power-planner-math.md.
 *
 *   node tools/power-planner-extract.mjs "path/to/Copy of GTNH Power Planner 2.9.xlsx"
 *
 * (the 2.9 copy whose EOH sheet is "13. EOH"; the later copies renumber it)
 *
 * Writes src/lib/power/data/power-planner-data.json. Deterministic: same
 * workbook, same output. No dependencies - the zip reader below handles the
 * stored/deflated entries an xlsx actually uses.
 */
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { fileURLToPath } from "node:url";

const xlsxPath = process.argv[2];
if (!xlsxPath) {
  console.error("Usage: node tools/power-planner-extract.mjs <workbook.xlsx>");
  process.exit(1);
}
const repoRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const outPath = path.join(repoRoot, "src", "lib", "power", "data", "power-planner-data.json");

// ---------------------------------------------------------------- zip reader

function readZipEntries(buffer) {
  // End of central directory: scan back for the signature.
  let eocd = -1;
  for (let i = buffer.length - 22; i >= 0; i--) {
    if (buffer.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) {
    throw new Error("Not a zip file (no end-of-central-directory record).");
  }
  const count = buffer.readUInt16LE(eocd + 10);
  let offset = buffer.readUInt32LE(eocd + 16);
  const entries = new Map();
  for (let i = 0; i < count; i++) {
    if (buffer.readUInt32LE(offset) !== 0x02014b50) {
      throw new Error("Corrupt central directory.");
    }
    const method = buffer.readUInt16LE(offset + 10);
    const compressedSize = buffer.readUInt32LE(offset + 20);
    const nameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    const localOffset = buffer.readUInt32LE(offset + 42);
    const name = buffer.toString("utf8", offset + 46, offset + 46 + nameLength);
    entries.set(name, { method, compressedSize, localOffset });
    offset += 46 + nameLength + extraLength + commentLength;
  }
  return {
    read(name) {
      const entry = entries.get(name);
      if (!entry) {
        throw new Error(`Missing zip entry: ${name}`);
      }
      const local = entry.localOffset;
      if (buffer.readUInt32LE(local) !== 0x04034b50) {
        throw new Error(`Corrupt local header for ${name}.`);
      }
      const nameLength = buffer.readUInt16LE(local + 26);
      const extraLength = buffer.readUInt16LE(local + 28);
      const start = local + 30 + nameLength + extraLength;
      const raw = buffer.subarray(start, start + entry.compressedSize);
      if (entry.method === 0) {
        return raw.toString("utf8");
      }
      if (entry.method === 8) {
        return zlib.inflateRawSync(raw).toString("utf8");
      }
      throw new Error(`Unsupported zip method ${entry.method} for ${name}.`);
    },
  };
}

// ------------------------------------------------------------- sheet parsing

const zip = readZipEntries(fs.readFileSync(xlsxPath));

function decodeXml(text) {
  return text
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#10;/g, "\n");
}

const sharedStrings = [];
{
  const xml = zip.read("xl/sharedStrings.xml");
  for (const m of xml.matchAll(/<si(?:\/>|>([\s\S]*?)<\/si>)/g)) {
    const body = m[1] ?? "";
    const parts = [...body.matchAll(/<t[^>]*(?:\/>|>([\s\S]*?)<\/t>)/g)].map((x) => x[1] ?? "");
    sharedStrings.push(decodeXml(parts.join("")));
  }
}

const sheetPathByName = new Map();
{
  const workbook = zip.read("xl/workbook.xml");
  const rels = zip.read("xl/_rels/workbook.xml.rels");
  const relTargets = new Map();
  for (const m of rels.matchAll(/Id="(rId\d+)"[^>]*Target="([^"]+)"/g)) {
    relTargets.set(m[1], m[2]);
  }
  for (const m of workbook.matchAll(/<sheet [^>]*name="([^"]+)"[^>]*r:id="(rId\d+)"/g)) {
    sheetPathByName.set(decodeXml(m[1]), `xl/${relTargets.get(m[2])}`);
  }
}

function columnIndex(letters) {
  let value = 0;
  for (const ch of letters) {
    value = value * 26 + (ch.charCodeAt(0) - 64);
  }
  return value;
}

/** Sheet -> Map("C12" -> string | number). Only value cells; formulas keep their cached value. */
function loadSheet(name) {
  const sheetPath = sheetPathByName.get(name);
  if (!sheetPath) {
    throw new Error(`Workbook has no sheet named "${name}".`);
  }
  const xml = zip.read(sheetPath);
  const cells = new Map();
  for (const cm of xml.matchAll(/<c ([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
    const attrs = cm[1];
    const body = cm[2];
    if (body === undefined) {
      continue;
    }
    const ref = attrs.match(/r="([A-Z]+\d+)"/)?.[1];
    const type = attrs.match(/t="(\w+)"/)?.[1];
    const raw = body.match(/<v>([\s\S]*?)<\/v>/)?.[1];
    if (ref === undefined || raw === undefined) {
      continue;
    }
    if (type === "s") {
      cells.set(ref, sharedStrings[Number(raw)] ?? "");
    } else if (type === "str") {
      cells.set(ref, decodeXml(raw));
    } else {
      cells.set(ref, Number(raw));
    }
  }
  return cells;
}

/** Rows of a rectangular range; each row is the array of cell values (null for blank). */
function rangeRows(cells, range) {
  const m = range.match(/^([A-Z]+)(\d+):([A-Z]+)(\d+)$/);
  if (!m) {
    throw new Error(`Bad range ${range}`);
  }
  const [c0, r0, c1, r1] = [columnIndex(m[1]), Number(m[2]), columnIndex(m[3]), Number(m[4])];
  const rows = [];
  for (let r = r0; r <= r1; r++) {
    const row = [];
    for (let c = c0; c <= c1; c++) {
      let letters = "";
      let n = c;
      while (n > 0) {
        letters = String.fromCharCode(65 + ((n - 1) % 26)) + letters;
        n = Math.floor((n - 1) / 26);
      }
      row.push(cells.get(`${letters}${r}`) ?? null);
    }
    rows.push(row);
  }
  return rows;
}

/** Named-fuel table: rows where the first column is a non-empty string. "None" rows dropped. */
function fuelTable(cells, range, fields) {
  const out = [];
  for (const row of rangeRows(cells, range)) {
    const name = row[0];
    if (typeof name !== "string" || name.trim() === "" || name === "None") {
      continue;
    }
    const entry = { name: name.trim() };
    fields.forEach((field, index) => {
      if (field) {
        entry[field] = row[index + 1];
      }
    });
    out.push(entry);
  }
  return out;
}

// ------------------------------------------------------------------ extract

const fuelData = loadSheet("Fuel Data");
const rotorData = loadSheet("Rotor Data");
const singleblocks = loadSheet("Singleblocks");
const eoh = loadSheet("13. EOH") ?? null;

const data = {
  source: "GTNH Power Planner 2.9 (community spreadsheet by Fox)",
  extractedAt: new Date().toISOString().slice(0, 10),

  steamGrades: fuelTable(fuelData, "B6:C11", ["euPerLiter"]),
  gasFuels: fuelTable(fuelData, "B15:C41", ["euPerLiter"]),
  gasFuelsXl: fuelTable(fuelData, "B45:C70", ["euPerLiter"]),
  plasmas: fuelTable(fuelData, "E6:G115", ["euPerLiter", "eheMaxLps"]),
  combustionFuels: fuelTable(fuelData, "BA40:BB59", ["euPerLiter"]),
  eceFuels: fuelTable(fuelData, "BA63:BB65", ["euPerLiter"]),
  semifluidFuels: fuelTable(fuelData, "BE60:BF79", ["euPerLiter"]),
  chemFuels: fuelTable(fuelData, "BV18:BX37", [null, "euPerLiter"]),
  // Geothermal Engine fuels (BA69:BB72): the lavas are fluids, the dusts items.
  frostFuels: fuelTable(fuelData, "BA69:BB72", ["euPerLiter"]).map((entry) =>
    entry.name.endsWith("Dust") ? { name: entry.name, euPerItem: entry.euPerLiter } : entry,
  ),
  // Large Neutralization Engine: base additives, structure tiers, robot arms.
  lneBases: fuelTable(fuelData, "BV40:BY44", [null, "multiplier", "litersPerSecond"]),
  lneStructureTiers: rangeRows(fuelData, "CA18:CC20").map((row) => ({
    name: row[0],
    residueCapacity: row[1],
    baseDecay: row[2],
  })),
  lneRobotArms: rangeRows(fuelData, "CA23:CB34").map((row) => ({
    name: row[0],
    tier: row[1],
  })),
  ucfeFuels: fuelTable(fuelData, "BE6:BG56", ["euPerLiter", "promoterCoefficient"]),
  magicSolids: fuelTable(fuelData, "BI6:BJ96", ["euPerItem"]),
  naquadahRods: fuelTable(fuelData, "BR18:BS27", ["euPerItem"]),
  rocketFuels: fuelTable(fuelData, "BL47:BM50", ["euPerLiter"]),

  lnrFuels: fuelTable(fuelData, "BL6:BO14", ["euPerTick", "secondsPerCell", "euPerThousandLiters"]),
  lnrCoolants: fuelTable(fuelData, "BL17:BN21", ["efficiency", "litersPerSecond"]),
  lnrBoosters: fuelTable(fuelData, "BL24:BN29", ["multiplier", "litersPerSecond"]),

  lftrFuels: fuelTable(fuelData, "BL41:BS43", [
    "euPerLiter",
    "powerLabel",
    "uSalt",
    "tSalt",
    "tbSalt",
    "uf6",
    "uranium233PerSecond",
  ]),
  lftbRecipes: rangeRows(fuelData, "BL33:BQ37").map((row) => ({
    name: row[0],
    fuelName: row[1],
    eut: row[2],
    durationSeconds: row[3],
    baseTier: row[4],
    outputLiters: row[5],
  })),

  htgrPebbles: fuelTable(fuelData, "BL54:BO62", ["base", "mult", "exp"]),

  boilerFuels: {
    bronzeLiquid: fuelTable(fuelData, "AS6:AU63", ["euPerLiter", "burnTime"]),
    bronzeSolid: fuelTable(fuelData, "AS64:AU85", ["euPerItem", "burnTime"]),
    steelLiquid: fuelTable(fuelData, "AW6:AY63", ["euPerLiter", "burnTime"]),
    steelSolid: fuelTable(fuelData, "AW64:AY83", ["euPerItem", "burnTime"]),
    titaniumLiquid: fuelTable(fuelData, "BA6:BC16", ["euPerLiter", "burnTime"]),
    titaniumSolid: fuelTable(fuelData, "BA17:BC19", ["euPerItem", "burnTime"]),
    tungstensteelLiquid: fuelTable(fuelData, "BA23:BC33", ["euPerLiter", "burnTime"]),
    tungstensteelSolid: fuelTable(fuelData, "BA34:BC36", ["euPerItem", "burnTime"]),
  },

  heatExchangers: rangeRows(fuelData, "CF6:CF9")
    .map((row, index) => ({ name: row[0], row: 6 + index }))
    .filter((entry) => typeof entry.name === "string")
    .map((entry) => {
      const fluids = {};
      for (const [fluid, startCol] of [
        ["Lava", "CI"],
        ["Pahoehoe Lava", "CO"],
        ["Hot Coolant", "CU"],
        ["Hot Solar Salt", "DA"],
      ]) {
        const row = rangeRows(fuelData, `${startCol}${entry.row}:${offsetColumn(startCol, 4)}${entry.row}`)[0];
        const [threshold, max, throttle, underRatio, overRatio] = row;
        if (typeof threshold === "number" && threshold > 0) {
          fluids[fluid] = { threshold, max, throttle, underRatio, overRatio };
        }
      }
      return { name: entry.name, fluids };
    }),

  fusionRecipes: rangeRows(fuelData, "J6:S71")
    .map((row, index) => ({
      name: row[0],
      minMark: row[1],
      euPerLiter: row[2],
      startupEu: row[3],
      input1: row[4],
      ratio1: row[5],
      input2: row[6],
      ratio2: row[7],
      eheMaxLps: row[8],
      decayOutput: row[9],
      outputLpsByMark: rangeRows(fuelData, `U${6 + index}:Y${6 + index}`)[0],
      drainEutByMark: rangeRows(fuelData, `AA${6 + index}:AE${6 + index}`)[0],
      compactOutputLpsByMark: rangeRows(fuelData, `AG${6 + index}:AK${6 + index}`)[0],
      compactDrainEutByMark: rangeRows(fuelData, `AM${6 + index}:AQ${6 + index}`)[0],
    }))
    .filter((entry) => typeof entry.name === "string" && entry.name.trim() !== ""),

  rotors: rangeRows(rotorData, "B6:G171")
    .map((row, index) => ({ row: 6 + index, name: row[0], tier: row[1], unlock: row[2], durability: row[4], overflowTier: row[5] }))
    .filter((entry) => typeof entry.name === "string" && entry.name.trim() !== "")
    .map((entry) => ({
      name: entry.name.trim(),
      unlock: typeof entry.unlock === "string" ? entry.unlock.split("-")[1]?.trim() ?? entry.unlock : entry.unlock,
      durability: entry.durability,
      overflowTier: entry.overflowTier,
      steam: rotorClass(entry.row, "Z", "AT", "AE", "AY"),
      gas: rotorClass(entry.row, "BN", "CH", "BS", "CM"),
      plasma: { ...rotorClass(entry.row, "DB", "DV", "DG", "EA"), euAtOptimalTight: rangeRows(rotorData, `DL${entry.row}:DO${entry.row}`)[0] },
    })),
  rotorSizes: rangeRows(rotorData, "B174:E177").map((row) => ({
    name: row[0],
    durabilityMult: row[1],
    efficiencyDelta: row[2],
    damage: row[3],
  })),

  singleblockTiers: rangeRows(singleblocks, "AE6:AG17")
    .map((row) => ({ tier: row[0], voltage: row[1], ampLoss: row[2] }))
    .filter((entry) => typeof entry.tier === "string" && entry.tier.trim() !== ""),
  // Efficiency ladders per family; column letters are the workbook's own layout.
  singleblockEfficiency: Object.fromEntries(
    Object.entries({
      steamTurbine: "AH",
      gasTurbine: "AJ",
      combustion: "AL",
      semifluid: "AN",
      chem: "AP",
      frost: "AR",
      rocket: "AT",
      plasma: "AV",
      naquadah: "AX",
      // AZ is the CONVERTER's ladder, BB the absorber's (Singleblocks K46
      // and S46 lookups) - these were once swapped and taxed the absorber
      // with the converter's numbers.
      magicConverter: "AZ",
      magicAbsorber: "BB",
    }).map(([family, col]) => [
      family,
      rangeRows(singleblocks, `${col}6:${col}17`).map((row) => row[0]),
    ]),
  ),

  eohStars: eoh
    ? rangeRows(eoh, "AA6:AH48")
        .map((row) => ({
          name: row[0],
          tier: row[1],
          // Column AC is seconds (EyeOfHarmonyRecipeStorage.timeCalculator).
          durationSeconds: row[2],
          baseSuccess: row[3],
          efficiency: row[4],
          euInput: row[5],
          euOutput: row[6],
          starMatter: row[7],
        }))
        .filter((entry) => typeof entry.name === "string" && entry.name.trim() !== "")
    : [],
};

function offsetColumn(letters, offset) {
  let n = columnIndex(letters) + offset;
  let out = "";
  while (n > 0) {
    out = String.fromCharCode(65 + ((n - 1) % 26)) + out;
    n = Math.floor((n - 1) / 26);
  }
  return out;
}

function rotorClass(row, effTight, effLoose, optTight, optLoose) {
  return {
    efficiencyTight: rangeRows(rotorData, `${effTight}${row}:${offsetColumn(effTight, 3)}${row}`)[0],
    efficiencyLoose: rangeRows(rotorData, `${effLoose}${row}:${offsetColumn(effLoose, 3)}${row}`)[0],
    optimalTight: rangeRows(rotorData, `${optTight}${row}:${offsetColumn(optTight, 3)}${row}`)[0],
    optimalLoose: rangeRows(rotorData, `${optLoose}${row}:${offsetColumn(optLoose, 3)}${row}`)[0],
  };
}

// --------------------------------------------------------- Java corrections
//
// Where the workbook and the pack's Java (GT5U tag 5.09.54.20) disagree, the
// Java wins. Each correction names the class or loader it follows, so the JSON
// stays a pure function of workbook + this file. Never hand-edit the JSON.

const withoutNames = (rows, names) => rows.filter((row) => !names.includes(row.name));

function correctEngineFuels() {
  // Not registered anywhere in the pack (no fuel recipe, no fluid in the 2.9 dataset).
  data.semifluidFuels = withoutNames(data.semifluidFuels, [
    "Raw Animal Waste",
    "Manure Slurry",
    "Fertile Manure Slurry",
  ]);
  // The sheet lists Ether twice (diesel and gas rows); one option per fuel.
  data.ucfeFuels = data.ucfeFuels.filter(
    (row, index, rows) => rows.findIndex((other) => other.name === row.name) === index,
  );
  // MTELargeNeutralizationEngine reads ItemList.ROBOT_ARMS from index 0 (LV).
  if (!data.lneRobotArms.some((row) => row.tier === 0)) {
    data.lneRobotArms.unshift({ name: "Amount (LV)", tier: 0 });
  }
  // useBooster: each hydroxide dust lasts this many ticks, then one more tick to reload.
  const boostTicks = {
    "Sodium Hydroxide": 20,
    "Potassium Hydroxide": 50,
    "Caesium Hydroxide": 200,
    "Francium Hydroxide": 240,
  };
  data.lneBases = data.lneBases.map((row) => ({ ...row, boostTicks: boostTicks[row.name] }));
}

// Rotor columns are what TurbineStatCalculator returns for a rotor made by
// MetaGeneratedTool.getToolWithStats. The game computes them in Java float, and
// the sheet in double: at the ties (base efficiency 1.3, 2.1) Math.round(base * 85)
// lands one step lower in float, and large loose flows differ past float precision.
const f32 = Math.fround;

// ToolTurbineSmall/Normal/Large/Huge: getSpeedMultiplier and getBaseDamage.
const TURBINE_SIZES = [
  { speed: 1, damage: 0 },
  { speed: 2, damage: 2.5 },
  { speed: 3, damage: 5 },
  { speed: 4, damage: 7.5 },
];

/** TurbineStatCalculator for one size, float-exact. `stats` are the material's tool fields. */
function turbineStats(stats, sizeIndex) {
  const size = TURBINE_SIZES[sizeIndex];
  // getBaseEfficiency: 0.5F + (0.5F + getToolCombatDamage) * 0.1F; combat damage = base damage + mToolQuality.
  const base = f32(0.5 + f32(f32(0.5 + f32(size.damage + stats.quality)) * f32(0.1)));
  // getLooseEfficiency: (float) (-0.2f + Math.round(base * 85.0f) * 0.01), the round on a float product.
  const loose = f32(f32(-0.2) + Math.round(f32(base * 85)) * 0.01);
  const flow = f32(f32(size.speed * f32(stats.speed)) * 50);
  const exponent = f32(f32(base - f32(0.8)) * 20);
  const steam = f32(flow * f32(stats.steamMultiplier));
  const gas = f32(flow * f32(stats.gasMultiplier));
  const plasma = f32(f32(flow * f32(stats.plasmaMultiplier)) * 42);
  return {
    // The tight efficiency keeps the sheet's double form; it is the same number to float precision.
    efficiencyTight: 0.5 + (0.5 + size.damage + stats.quality) * 0.1,
    steam: {
      efficiencyLoose: f32(loose * f32(0.9)),
      optimalTight: steam,
      optimalLoose: f32(f32(3 * steam) * f32(Math.pow(f32(1.1), exponent))),
    },
    gas: {
      efficiencyLoose: f32(loose * f32(0.95)),
      optimalTight: gas,
      optimalLoose: f32(f32(2 * gas) * f32(Math.pow(f32(1.05), exponent))),
    },
    plasma: {
      efficiencyLoose: loose,
      optimalTight: plasma,
      optimalLoose: f32(f32(2 * plasma) * f32(Math.pow(f32(1.03), exponent))),
      euAtOptimalTight: f32(plasma * base),
    },
  };
}

/**
 * A bartworks rotor's tool stats: Werkstoff.getToolQuality, getToolSpeed and
 * getDurability, in float, from the Werkstoff's protons (summed over its
 * contents), mass (averaged), melting point and content count (the amounts'
 * sum for a compound or mixture).
 */
function werkstoffToolStats({ protons, mass, meltingPoint, contentCount }) {
  const quality = Math.trunc(f32(f32(15 * f32(f32(protons / 188) + f32(meltingPoint / 10801))) / contentCount));
  const sum = f32(f32(-mass + f32(f32(0.1) * meltingPoint)) + protons);
  const speed = Math.max(1, f32(f32(f32(f32(f32(2 * sum) * f32(0.1)) / contentCount) * f32(0.1)) * quality));
  const durability = Math.trunc(f32(f32(f32(f32(0.01) * meltingPoint) * mass) / contentCount));
  return { quality, speed, durability };
}

function correctRotors() {
  // Base stats: C tier (mToolQuality), E mining speed (mToolSpeed), F durability
  // (100 x mDurability), H/I/J steam, gas and plasma multipliers.
  const base = new Map(
    rangeRows(rotorData, "B6:J171")
      .filter((row) => typeof row[0] === "string" && row[0].trim() !== "")
      .map((row) => [
        row[0].trim(),
        {
          quality: row[1],
          speed: row[3],
          durability: row[4],
          steamMultiplier: row[6],
          gasMultiplier: row[7],
          plasmaMultiplier: row[8],
        },
      ]),
  );

  // Where the pack's materials differ from the sheet's.
  const javaStats = {
    // WerkstoffLoader.HDCS, a mixture of 12 Tungstensteel, 9 HSS-E, 6 HSS-G,
    // 3 Ruridit, 2 Magneto Resonatic and 1 Plutonium: 5552 protons, mass 107.
    "High Durability Compound Steel": werkstoffToolStats({ protons: 5552, mass: 107, meltingPoint: 9000, contentCount: 33 }),
    // GGMaterial.atomicSeparationCatalyst, a compound of 2 Orundum (120 protons,
    // mass 196), 1 Plutonium (94, 246) and 2 Naquadah (130, 330).
    "Atomic Separation Catalyst": werkstoffToolStats({
      protons: 2 * 120 + 94 + 2 * 130,
      mass: Math.trunc((2 * 196 + 246 + 2 * 330) / 5),
      meltingPoint: 5000,
      contentCount: 5,
    }),
    // MaterialsInit.loadUniversium: setTool(10_485_760, 30, 1.0f).
    Universium: { quality: 30 },
  };

  for (const rotor of data.rotors) {
    const stats = base.get(rotor.name);
    if (!stats) {
      throw new Error(`Rotor ${rotor.name} has no base stats row.`);
    }
    const fix = javaStats[rotor.name];
    if (fix) {
      Object.assign(stats, fix);
      if (fix.durability !== undefined) {
        // MetaGeneratedTool.getToolWithStats: MaxDamage = 100 x mDurability x size multiplier.
        stats.durability = 100 * fix.durability;
      }
    }
    rotor.durability = stats.durability;
    // TurbineStatCalculator.getOverflowEfficiency: 1 + min(2, mToolQuality / 3), integer division.
    rotor.overflowTier = 1 + Math.min(2, Math.trunc(stats.quality / 3));
    const sizes = TURBINE_SIZES.map((_, index) => turbineStats(stats, index));
    for (const turbineClass of ["steam", "gas", "plasma"]) {
      const target = rotor[turbineClass];
      target.efficiencyTight = sizes.map((size) => size.efficiencyTight);
      for (const field of Object.keys(sizes[0][turbineClass])) {
        target[field] = sizes.map((size) => size[turbineClass][field]);
      }
    }
  }
}

function correctSteamMakers() {
  // MTEThermalBoiler runs RecipesGregTech.thermalBoilerRecipes: 1000 L of lava or
  // pahoehoe lava a second makes 16,000 L of plain Steam, so 16 per L, not 160.
  const thermal = data.heatExchangers.find((row) => row.name === "Thermal Boiler");
  for (const fluid of ["Lava", "Pahoehoe Lava"]) {
    if (thermal?.fluids[fluid]) {
      thermal.fluids[fluid] = { ...thermal.fluids[fluid], underRatio: 16, overRatio: 16 };
    }
  }
  // LargeBoilerFuelBackend.ALLOWED_FUELS: the superheated boilers refuse any other fluid.
  const refusedBySuperheated = ["Naquadah Gas", "Nefarious Gas", "Nitrobenzene"];
  data.boilerFuels.titaniumLiquid = withoutNames(data.boilerFuels.titaniumLiquid, refusedBySuperheated);
  data.boilerFuels.tungstensteelLiquid = withoutNames(
    data.boilerFuels.tungstensteelLiquid,
    refusedBySuperheated,
  );
  // MTELargeBoilerBase burns a solid for fuel value / 80 ticks, then the tier's
  // runtimeBoost. The log bonus in LargeBoilerFuelBackend only feeds the NEI page.
  const runtimeBoost = {
    bronzeSolid: (ticks) => ticks * 2,
    steelSolid: (ticks) => ticks,
    titaniumSolid: (ticks) => Math.trunc((ticks * 3) / 10),
    tungstensteelSolid: (ticks) => Math.trunc((ticks * 15) / 100),
  };
  for (const [table, boost] of Object.entries(runtimeBoost)) {
    data.boilerFuels[table] = data.boilerFuels[table].map((row) => ({
      ...row,
      burnTime: boost(Math.trunc(row.euPerItem / 80)) / 20,
    }));
  }
}

function correctReactors() {
  // RecipeLoaderLFTR: LFTR Fuel 2 (LiFBeF2ZrF4UF4) leaves 100 L of TB Salt
  // (LiFBeF2ThF4), not T Salt.
  data.lftrFuels = data.lftrFuels.map((row) =>
    row.name === "LFTR Fuel 2" ? { ...row, tSalt: 0, tbSalt: 100 } : row,
  );
}

correctEngineFuels();
correctRotors();
correctSteamMakers();
correctReactors();

fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, JSON.stringify(data, null, 1) + "\n");
const counts = Object.fromEntries(
  Object.entries(data)
    .filter(([, value]) => Array.isArray(value))
    .map(([key, value]) => [key, value.length]),
);
console.log(`Wrote ${outPath}`);
console.log(counts);
