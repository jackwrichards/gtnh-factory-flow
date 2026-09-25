/**
 * The LFTR sparge tower's rolled outputs.
 *
 * MTESpargeTower.randomizeByproducts rolls every run: the fluid outputs from
 * the third on are byproducts, each `MathUtils.randInt(1, min(max, gas -
 * total - 1))` litres (inclusive, `total` counting the byproducts rolled
 * before it), and the second output is the sparge gas handed back, `gas -
 * total`. The recipe registers all of them at 0 L, so an export that keeps
 * only positive amounts loses every one; the oracle exports them for this map
 * (`spargeFluidOutputs`, `spargeMaxByproduct`, `spargeGasAmount`) and this
 * module replays the roll's exact expectation.
 */

/**
 * Expected litres of each byproduct, in roll order, and of the returned gas.
 * An exact walk over the running total, so the rare case where the cap
 * shrinks (earlier rolls ate the gas) is priced too.
 */
export function spargeExpectedLitres(gas, maxByproduct, byproductCount) {
  let totals = new Map([[0, 1]]);
  const byproducts = [];
  for (let roll = 0; roll < byproductCount; roll += 1) {
    const next = new Map();
    let mean = 0;
    for (const [total, weight] of totals) {
      // randInt(1, hi) is nextInt(hi) + 1: uniform over 1..hi.
      const hi = Math.max(1, Math.min(maxByproduct, gas - total - 1));
      mean += weight * ((hi + 1) / 2);
      const share = weight / hi;
      for (let litres = 1; litres <= hi; litres += 1) {
        next.set(total + litres, (next.get(total + litres) ?? 0) + share);
      }
    }
    byproducts.push(mean);
    totals = next;
  }
  const spent = byproducts.reduce((sum, value) => sum + value, 0);
  // Summing thousands of shares leaves float dust (10.500000000000004); a
  // nanolitre keeps the real shrink (the TB recipe's 47.500003125 L) and
  // drops the noise.
  const clean = (value) => Math.round(value * 1e9) / 1e9;
  return { byproducts: byproducts.map(clean), gasReturned: clean(gas - spent) };
}

/**
 * The rolled outputs of one exported sparging recipe as expected-litre
 * slots (gas first, then the byproducts), or undefined for any other
 * recipe. `toResource` is the normalizer's own slot builder.
 */
export function spargeRolledOutputs(rawRecipe, toResource) {
  const fluids = rawRecipe?.spargeFluidOutputs;
  const maxByproduct = Number(rawRecipe?.spargeMaxByproduct);
  const gas = Number(rawRecipe?.spargeGasAmount ?? rawRecipe?.fluidInputs?.[0]?.amount);
  if (!Array.isArray(fluids) || fluids.length < 3 || !(maxByproduct > 0) || !(gas > 0)) {
    return undefined;
  }
  const expected = spargeExpectedLitres(gas, maxByproduct, fluids.length - 2);
  const outputs = [
    toResource({ ...fluids[1], amount: expected.gasReturned }),
    ...fluids.slice(2).map((fluid, index) => toResource({ ...fluid, amount: expected.byproducts[index] })),
  ].filter(Boolean);
  return {
    outputs,
    maxByproduct,
    note: `Byproducts are random: 1 to ${maxByproduct} L of each per run. Rates are the average.`,
  };
}
