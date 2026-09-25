/**
 * The Extreme Entity Crusher's drop arithmetic, replayed from the exported mob
 * tables (kubatech MobHandlerLoader.MobEECRecipe.generateOutputs, GT5U
 * 5.09.54.20, over MobsInfo 0.5.18's MobDrop / IChanceModifier).
 *
 * A drop's stored `chance` is out of 10,000. The EEC turns it into a percent,
 * runs every chance modifier over it in order, truncates back to the 10,000
 * scale, cuts player-only drops to a tenth (at least 1), and only then adds
 * 5,000 per level of Looting to lootable drops, splitting anything over
 * 10,000 into whole extra items.
 *
 * Modifiers read the world, the killer and the entity. The planner models a
 * plain EEC: in the Overworld, the kill made by the EEC's own fake player
 * holding whatever weapon is set, an unpowered, unpotioned mob. Each modifier
 * class below was read out of its bytecode for that case; a class this file
 * does not know counts as a gate, so the planner never promises a drop it
 * cannot show the machine makes.
 */

export const EEC_MACHINE_TYPE = "Extreme Entity Crusher";

/** Looting's enchantment id, which EachLevelOfGives checks the held weapon for. */
const LOOTING_ENCHANTMENT_ID = 21;

/** Modifiers that leave the chance alone in a plain EEC. */
const KEEPS_CHANCE = new Set([
  // Biome / weapon alternatives: the EEC's biome is not modelled and no
  // special weapon is held, so the ordinary chance stands.
  "IChanceModifier$OrBiome",
  "IChanceModifier$OrUsing",
  // Forbidden Magic's greed focus bonus is wand-only; the base passes through.
  "ForbiddenMagic$EachLevelOfGivesFocus",
  // Size checks against the entity copy MobsInfo already averaged into the chance.
  "Minecraft$MinecraftSlime",
  "Minecraft$MinecraftMagmaCube",
  "BloodMagic$MinorDemonGruntShards",
]);

/**
 * Modifiers that zero the drop in a plain EEC: a required enchantment, weapon,
 * potion, dimension other than the Overworld, a charged creeper, a wither or
 * non-player killer (the EEC kills with a fake player), a vampire book.
 */
const ZEROES_CHANCE = new Set([
  "IChanceModifier$DropsOnlyWithEnchant",
  "IChanceModifier$DropsOnlyUsing",
  "IChanceModifier$DropsOnlyWithWeaknessIII",
  "IChanceModifier$PoweredCreeper",
  "DraconicEvolution$DraconicEvolutionSoulChanceModifier",
  "ForbiddenMagic$NonPlayerEntity",
  "EtFuturum$WitherRoseModifier",
  "EtFuturum$DropsOnlyWhenKilledByPoweredCreeperModifier",
  "BloodMagic$DemonDemonPlacer",
  "OpenBlocks$OpenBlocksSmallChance",
  "Witchery$WitcheryVampireBook",
  "Witchery$WitcheryWarewolf",
  "Avaritia$AvaritiaSkullSwordModifier",
  "BloodArsenal$DropsOnlyWithWeakness",
  "TinkerToolEvents$BeheadingModifier",
]);

function modifierName(modifier) {
  return String(modifier?.className ?? "").split(".").pop();
}

/** Every modifier class the export carried that this file has no rule for. */
export function unknownEecModifiers(mobs) {
  const unknown = new Set();
  for (const mob of mobs ?? []) {
    for (const drop of mob.drops ?? []) {
      for (const modifier of drop.chanceModifiers ?? []) {
        const name = modifierName(modifier);
        if (!knownModifier(name)) unknown.add(name);
      }
    }
  }
  return [...unknown].sort();
}

function knownModifier(name) {
  return (
    name === "IChanceModifier$NormalChance" ||
    name === "IChanceModifier$BaseChance" ||
    name === "IChanceModifier$DropsOnlyInDimension" ||
    name === "IChanceModifier$EachLevelOfGives" ||
    KEEPS_CHANCE.has(name) ||
    ZEROES_CHANCE.has(name)
  );
}

/** One modifier's `apply`, in percent, for a plain Overworld EEC. */
function applyModifier(percent, modifier, looting) {
  const name = modifierName(modifier);
  const fields = modifier?.fields ?? {};
  switch (name) {
    case "IChanceModifier$NormalChance":
    case "IChanceModifier$BaseChance": {
      const chance = Number(fields.chance);
      return Number.isFinite(chance) ? chance : percent;
    }
    case "IChanceModifier$DropsOnlyInDimension":
      return percent !== 0 && Number(fields.dimension) === 0 ? percent : 0;
    case "IChanceModifier$EachLevelOfGives":
      // Adds its step once when the held weapon has the enchantment at all.
      return fields.enchantment?.id === LOOTING_ENCHANTMENT_ID && looting > 0
        ? percent + Number(fields.change ?? 0)
        : percent;
    default:
      return KEEPS_CHANCE.has(name) ? percent : 0;
  }
}

/**
 * The drop's chance out of 10,000 after modifiers and the player-only cut,
 * before Looting's lootable bonus. `looting` only matters to modifiers that
 * read the weapon's Looting (Forbidden Magic's greed shards).
 */
export function eecDropChance(drop, { looting = 0, playerOnlyModifier = 0.1 } = {}) {
  let percent = Number(drop.chance ?? 0) / 100;
  for (const modifier of drop.chanceModifiers ?? []) {
    percent = applyModifier(percent, modifier, looting);
  }
  let chance = Math.trunc(percent * 100);
  if (!(chance > 0)) return 0;
  if (drop.playerOnly) {
    chance = Math.max(1, Math.trunc(chance * playerOnlyModifier));
  }
  return chance;
}

/**
 * Expected items from one roll of a drop at a Looting level: the EEC adds
 * 5,000 per level to a lootable drop's chance and, past 10,000, divides it
 * into whole extra items (Math.ceil, then integer division).
 */
export function eecExpectedItems(amount, chance, lootable, looting) {
  if (!(chance > 0) || !(amount > 0)) return 0;
  let rolled = chance;
  let items = amount;
  if (lootable && looting > 0) {
    rolled += looting * 5000;
    if (rolled > 10000) {
      const div = Math.ceil(rolled / 10000);
      items *= div;
      rolled = Math.trunc(rolled / div);
    }
  }
  return items * (rolled >= 10000 ? 1 : rolled / 10000);
}
