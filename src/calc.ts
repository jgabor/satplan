import type { Catalog, Extraction, ExtractorLine, Recipe, Result, Stage } from "./types.ts";

export const DEFAULT_EXTRACTION: Extraction = { miner: 2, purity: "pure" };

const EPS = 1e-9;

/** Power use grows with clock speed to this power: 50% clock draws 40% of the power, not 50%. */
const CLOCK_POWER_EXPONENT = 1.321928;

/** Power draw of `count` identical buildings sharing the load at `clock` percent. */
const powerAt = (base: number, count: number, clock: number) =>
  base * count * (clock / 100) ** CLOCK_POWER_EXPONENT;
const MAX_ITERATIONS = 500;

function add(map: Map<string, number>, key: string, value: number) {
  map.set(key, (map.get(key) ?? 0) + value);
}

function countFor(runs: number) {
  return Math.max(1, Math.ceil(runs - EPS));
}

/**
 * Works out buildings, flows and leftovers for one chain at a target rate.
 *
 * Byproducts of one recipe reduce the demand for the same item elsewhere in the chain.
 * Leftover raw items are absorbed, leftover solids go to a sink, and leftover fluids
 * get the disposal recipe from the catalog. Returns null when the chain is incomplete
 * or the flows do not settle.
 */
export function evaluate(
  cat: Catalog,
  target: string,
  recipeIds: string[],
  rate: number,
  extraction: Extraction = DEFAULT_EXTRACTION,
): Result | null {
  const assigned = new Map<string, Recipe>();
  for (const id of recipeIds) {
    const recipe = cat.recipes[id];
    if (!recipe) return null;
    const item = recipe.outs[0][0];
    if (assigned.has(item)) return null;
    assigned.set(item, recipe);
  }
  if (!assigned.has(target)) return null;
  for (const recipe of assigned.values()) {
    for (const [item] of recipe.ins) {
      if (!cat.raw[item] && !assigned.has(item)) return null;
    }
  }

  let runs = new Map<string, number>();
  let consume = new Map<string, number>();
  let consumeByMake = new Map<string, number>();
  let supply = new Map<string, number>();
  let unresolved = new Set<string>();
  let settled = false;

  for (let iteration = 0; iteration < MAX_ITERATIONS && !settled; iteration++) {
    consume = new Map();
    consumeByMake = new Map();
    supply = new Map();
    for (const recipe of activeRecipes(cat, assigned, runs)) {
      const n = runs.get(recipe.id) ?? 0;
      if (n <= 0) continue;
      const isMake = assigned.get(recipe.outs[0][0]) === recipe;
      for (const [item, amount] of recipe.ins) {
        add(consume, item, amount * n);
        if (isMake) add(consumeByMake, item, amount * n);
      }
      recipe.outs.forEach(([item, amount], index) => {
        if (isMake && index === 0) return;
        add(supply, item, amount * n);
      });
    }

    const next = new Map<string, number>();
    for (const [item, recipe] of assigned) {
      const need =
        (item === target ? rate : 0) + (consume.get(item) ?? 0) - (supply.get(item) ?? 0);
      next.set(recipe.id, Math.max(0, need) / recipe.outs[0][1]);
    }
    unresolved = new Set();
    for (const [item, made] of supply) {
      if (cat.raw[item] || assigned.has(item)) continue;
      const left = made - (consumeByMake.get(item) ?? 0);
      if (left <= EPS || !cat.items[item]?.fluid) continue;
      const disposal = cat.disposal[item] ? cat.recipes[cat.disposal[item]] : undefined;
      if (!disposal) {
        unresolved.add(item);
        continue;
      }
      const amount = disposal.ins.find(([i]) => i === item)?.[1] ?? 1;
      add(next, disposal.id, left / amount);
    }

    settled = true;
    for (const [id, value] of next) {
      if (Math.abs(value - (runs.get(id) ?? 0)) > EPS) settled = false;
    }
    for (const id of runs.keys()) if (!next.has(id)) settled = false;
    runs = next;
  }
  if (!settled) return null;

  const levels = new Map<string, number>();
  const levelOf = (item: string, trail: Set<string>): number => {
    const known = levels.get(item);
    if (known !== undefined) return known;
    const recipe = assigned.get(item);
    if (!recipe || trail.has(item)) return 0;
    trail.add(item);
    let level = 1;
    for (const [ing] of recipe.ins) level = Math.max(level, 1 + levelOf(ing, trail));
    trail.delete(item);
    levels.set(item, level);
    return level;
  };

  const stages: Stage[] = [];
  let maxLevel = 0;
  for (const [item, recipe] of assigned) {
    const n = runs.get(recipe.id) ?? 0;
    if (n <= EPS) continue;
    const level = levelOf(item, new Set());
    maxLevel = Math.max(maxLevel, level);
    const count = countFor(n);
    stages.push({
      recipe,
      kind: "make",
      item,
      runs: n,
      count,
      clock: (n / count) * 100,
      ins: recipe.ins.map(([i, a]) => [i, a * n]),
      outs: recipe.outs.map(([i, a], k) => [i, a * n, k === 0 ? "main" : "by"]),
      level,
      power: powerAt(recipe.power, count, (n / count) * 100),
    });
  }
  const assignedIds = new Set([...assigned.values()].map((r) => r.id));
  for (const [id, n] of runs) {
    if (assignedIds.has(id) || n <= EPS) continue;
    const recipe = cat.recipes[id];
    const count = countFor(n);
    stages.push({
      recipe,
      kind: "dispose",
      item: recipe.ins[0][0],
      runs: n,
      count,
      clock: (n / count) * 100,
      ins: recipe.ins.map(([i, a]) => [i, a * n]),
      outs: recipe.outs.map(([i, a]) => [i, a * n, "by"]),
      level: maxLevel + 1,
      power: powerAt(recipe.power, count, (n / count) * 100),
    });
  }
  stages.sort((a, b) => a.level - b.level || a.recipe.name.localeCompare(b.recipe.name));

  const extractors: ExtractorLine[] = [];
  for (const [item, info] of Object.entries(cat.raw)) {
    const perMin = (consume.get(item) ?? 0) - (supply.get(item) ?? 0);
    if (perMin <= EPS) continue;
    const mined = info.building === "Miner Mk.2";
    const well = info.building === "Well satellite (pure)";
    const purity =
      mined || well || info.building === "Oil Extractor" ? extraction.purity : undefined;
    const purityFactor = purity === "impure" ? 0.25 : purity === "normal" ? 0.5 : 1;
    const capacity = info.perMin * purityFactor * (mined ? 2 ** (extraction.miner - 2) : 1);
    const count = countFor(perMin / capacity);
    const clock = (perMin / (count * capacity)) * 100;
    // Each miner level draws three times the power of the one below it (5, 15, 45 MW).
    const basePower = info.power * (mined ? 3 ** (extraction.miner - 2) : 1);
    extractors.push({
      item,
      perMin,
      building: mined
        ? `Miner Mk.${extraction.miner}`
        : well
          ? `Well satellite (${purity})`
          : info.building,
      count,
      clock,
      purity,
      power: powerAt(basePower, count, clock),
    });
  }
  extractors.sort((a, b) => a.item.localeCompare(b.item));

  const sinks: [string, number][] = [];
  for (const [item, made] of supply) {
    if (cat.raw[item] || assigned.has(item) || cat.items[item]?.fluid) continue;
    const left = made - (consumeByMake.get(item) ?? 0);
    if (left > EPS) sinks.push([item, left]);
  }

  const totals = new Map<string, number>();
  for (const s of stages) add(totals, s.recipe.building, s.count);
  for (const e of extractors) add(totals, e.building, e.count);
  const totalList = [...totals.entries()];
  return {
    rate,
    stages,
    extractors,
    totals: totalList,
    buildings: totalList.reduce((sum, [, n]) => sum + n, 0),
    power: [...stages, ...extractors].reduce((sum, line) => sum + line.power, 0),
    stageCount: stages.length,
    rawTypes: extractors.length,
    sinks,
    unresolved: [...unresolved],
  };
}

function activeRecipes(cat: Catalog, assigned: Map<string, Recipe>, runs: Map<string, number>) {
  const list = [...assigned.values()];
  const ids = new Set(list.map((r) => r.id));
  for (const id of runs.keys()) if (!ids.has(id)) list.push(cat.recipes[id]);
  return list;
}

export type Metric = 0 | 1 | 2 | 3;

export const METRICS: { id: Metric; label: string }[] = [
  { id: 0, label: "Fewest stages, then buildings" },
  { id: 1, label: "Fewest buildings, then stages" },
  { id: 2, label: "Fewest raw inputs, then stages" },
  { id: 3, label: "Lowest power, then stages" },
];

/** Tiers that unlock at least one recipe, lowest first. */
export function recipeTiers(cat: Catalog): number[] {
  return [...new Set(Object.values(cat.recipes).map((r) => r.tier))].sort((a, b) => a - b);
}

/** Sort key for a result. Chains with a stuck byproduct always sort last. */
export function sortKey(result: Result, metric: Metric): number[] {
  const { stageCount, buildings, rawTypes } = result;
  const stuck = result.unresolved.length > 0 ? 1 : 0;
  // Rounded so float noise between equal chains cannot decide the order.
  if (metric === 3) return [stuck, Math.round(result.power * 1000) / 1000, stageCount, buildings];
  if (metric === 1) return [stuck, buildings, stageCount, rawTypes];
  if (metric === 2) return [stuck, rawTypes, stageCount, buildings];
  return [stuck, stageCount, buildings, rawTypes];
}

export function compareKeys(a: number[], b: number[]): number {
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] - b[i];
  return 0;
}

export type Ranked = { ids: string[]; result: Result };

/**
 * Evaluates every candidate for an item at one rate and sorts them best first.
 * With `maxTier`, chains that use a recipe unlocked in a later tier are left out.
 */
export function rankChains(
  cat: Catalog,
  item: string,
  rate: number,
  metric: Metric,
  extra: string[][] = [],
  extraction: Extraction = DEFAULT_EXTRACTION,
  maxTier: number | null = null,
): Ranked[] {
  const seen = new Set<string>();
  const ranked: Ranked[] = [];
  for (const ids of [...(cat.chains[item] ?? []), ...extra]) {
    const key = [...ids].sort().join("|");
    if (seen.has(key)) continue;
    seen.add(key);
    const result = evaluate(cat, item, ids, rate, extraction);
    if (!result) continue;
    if (maxTier !== null && result.stages.some((s) => s.recipe.tier > maxTier)) continue;
    ranked.push({ ids, result });
  }
  ranked.sort(
    (a, b) =>
      compareKeys(sortKey(a.result, metric), sortKey(b.result, metric)) ||
      a.ids.join("|").localeCompare(b.ids.join("|")),
  );
  return ranked;
}
