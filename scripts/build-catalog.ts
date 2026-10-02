// Builds src/data/catalog.json from the pinned Satisfactory Factories data.
// Usage: node scripts/build-catalog.ts [--fetch]
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Catalog, Recipe } from "../src/types.ts";

type DataRecipe = {
  id: string;
  displayName: string;
  ingredients: { part: string; perMin: number }[];
  products: { part: string; perMin: number; isByProduct: boolean }[];
  building: { name: string };
  isAlternate: boolean;
  isFicsmas: boolean;
  extraction?: {
    extractors: { building: string; ratePerMin: number }[];
    well?: { satelliteRates: Record<string, number> };
  };
};

type GameData = {
  recipes: DataRecipe[];
  items: {
    parts: Record<string, { name: string; isFluid: boolean; isFicsmas: boolean }>;
    rawResources: Record<string, { name: string }>;
  };
};

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const sources = JSON.parse(readFileSync(join(root, "data/sources.json"), "utf8"));
const rawDir = join(root, "data/raw");

async function load(name: string, path: string, force: boolean): Promise<string> {
  const file = join(rawDir, `${name}.json`);
  if (force || !existsSync(file)) {
    const url = `https://raw.githubusercontent.com/${sources.repo}/${sources.sha}/${path}`;
    console.log(`fetching ${url}`);
    const response = await fetch(url);
    if (!response.ok) throw new Error(`${url}: ${response.status}`);
    mkdirSync(rawDir, { recursive: true });
    writeFileSync(file, Buffer.from(await response.arrayBuffer()));
  }
  return readFileSync(file, "utf8").replace(/^\uFEFF/, "");
}

const force = process.argv.includes("--fetch");
const data: GameData = JSON.parse(await load("gameData", sources.files.gameData, force));
const docs: { NativeClass: string; Classes: Record<string, any>[] }[] = JSON.parse(
  await load("game-docs", sources.files.gameDocs, force),
);

const BUILDINGS: Record<string, string> = {
  smeltermk1: "Smelter",
  foundrymk1: "Foundry",
  constructormk1: "Constructor",
  assemblermk1: "Assembler",
  manufacturermk1: "Manufacturer",
  oilrefinery: "Refinery",
  blender: "Blender",
  packager: "Packager",
  converter: "Converter",
  hadroncollider: "Particle Accelerator",
  quantumencoder: "Quantum Encoder",
};

// Raw inputs the player can extract. Everything else (leaves, wood, mycelia, creature
// parts, power slugs) cannot come from a node, so recipes that need it are dropped.
const raw: Catalog["raw"] = {};
for (const r of data.recipes) {
  if (!r.id.startsWith("Extract_")) continue;
  const item = r.products[0].part;
  const name = data.items.rawResources[item]?.name ?? item;
  if (r.extraction?.well) {
    if (item !== "NitrogenGas") continue;
    raw[item] = {
      name,
      perMin: r.extraction.well.satelliteRates.pure,
      building: "Well satellite (pure)",
    };
    continue;
  }
  const ex = r.extraction!.extractors;
  const mk2 = ex.find((e) => e.building === "minermk2");
  const pump = ex.find((e) => e.building === "oilpump");
  const water = ex.find((e) => e.building === "waterpump");
  // Purity multipliers: pure is 2x for miners and oil extractors. Water has one purity.
  if (mk2) raw[item] = { name, perMin: mk2.ratePerMin * 2, building: "Miner Mk.2" };
  else if (pump) raw[item] = { name, perMin: pump.ratePerMin * 2, building: "Oil Extractor" };
  else if (water) raw[item] = { name, perMin: water.ratePerMin, building: "Water Extractor" };
}
const RAW = new Set(Object.keys(raw));
const parts = data.items.parts;
const isFluid = (item: string) => !!parts[item]?.isFluid;

// Resource conversions add a stage for no gain when extraction is free.
const usable = data.recipes.filter(
  (r) =>
    !r.isFicsmas &&
    !r.id.startsWith("Extract_") &&
    !(r.building.name === "converter" && r.products.some((p) => RAW.has(p.part))),
);

const recipes: Record<string, Recipe> = {};
for (const r of usable) {
  const mains = r.products.filter((p) => !p.isByProduct);
  if (!mains.length) continue;
  const outs = [...mains, ...r.products.filter((p) => p.isByProduct)];
  recipes[r.id] = {
    id: r.id,
    name: r.displayName.replace(/^Alternate: /, ""),
    alt: r.isAlternate,
    building: r.building.name,
    ins: r.ingredients.map((i) => [i.part, i.perMin]),
    outs: outs.map((p) => [p.part, p.perMin]),
  };
}

const producers = new Map<string, Recipe[]>();
for (const r of Object.values(recipes)) {
  if (RAW.has(r.outs[0][0])) continue;
  const list = producers.get(r.outs[0][0]) ?? [];
  list.push(r);
  producers.set(r.outs[0][0], list);
}

// Disposal: for each fluid, the simplest recipe that turns it into solids (to sink),
// raw items, or other fluids that can be disposed in turn.
type DisposalCost = { stages: number; frac: number; chain: Set<string> };
const disposal: Record<string, string> = {};
const disposalCost = new Map<string, DisposalCost>();
for (let pass = 0; pass < 12; pass++) {
  let changed = false;
  for (const item of Object.keys(parts)) {
    if (!isFluid(item) || RAW.has(item)) continue;
    let best: { id: string; cost: DisposalCost } | undefined;
    for (const r of Object.values(recipes)) {
      const amount = r.ins.find(([i]) => i === item)?.[1];
      if (!amount) continue;
      if (r.ins.some(([i]) => i !== item && !RAW.has(i))) continue;
      if (r.outs.some(([i]) => i === item)) continue;
      let stages = 1;
      let frac = 1 / amount;
      const chain = new Set([item]);
      let valid = true;
      for (const [out, outAmount] of r.outs) {
        if (RAW.has(out) || !isFluid(out)) continue;
        const nested = disposalCost.get(out);
        if (!nested || nested.chain.has(item)) {
          valid = false;
          break;
        }
        stages += nested.stages;
        frac += (outAmount / amount) * nested.frac;
        nested.chain.forEach((c) => chain.add(c));
      }
      if (!valid) continue;
      const cost = { stages, frac, chain };
      const current = best?.cost;
      if (!current || stages < current.stages || (stages === current.stages && frac < current.frac))
        best = { id: r.id, cost };
    }
    if (best && (disposal[item] !== best.id || !disposalCost.has(item))) {
      disposal[item] = best.id;
      disposalCost.set(item, best.cost);
      changed = true;
    }
  }
  if (!changed) break;
}

// Beam search over recipe assignments. A candidate maps each item in the chain to
// exactly one recipe, so every candidate is a tree without cycles or conflicts.
type Score = { stages: number; frac: number; raw: number };
type Cand = { map: Map<string, string>; key: string } & Score;

function score(target: string, map: Map<string, string>): Score {
  const levels = new Map<string, number>();
  const levelOf = (item: string): number => {
    const known = levels.get(item);
    if (known !== undefined) return known;
    let level = 1;
    for (const [ing] of recipes[map.get(item)!].ins)
      if (map.has(ing)) level = Math.max(level, 1 + levelOf(ing));
    levels.set(item, level);
    return level;
  };
  const order = [...map.keys()].sort((a, b) => levelOf(b) - levelOf(a));
  const demand = new Map<string, number>([[target, 1]]);
  const rawDemand = new Map<string, number>();
  const leftover = new Map<string, number>();
  let frac = 0;
  const bump = (m: Map<string, number>, k: string, v: number) => m.set(k, (m.get(k) ?? 0) + v);
  for (const item of order) {
    const r = recipes[map.get(item)!];
    const runs = (demand.get(item) ?? 0) / r.outs[0][1];
    frac += runs;
    for (const [ing, amount] of r.ins) bump(map.has(ing) ? demand : rawDemand, ing, amount * runs);
    r.outs.slice(1).forEach(([out, amount]) => bump(leftover, out, amount * runs));
  }
  let stages = order.length;
  for (const [item, amount] of leftover) {
    if (RAW.has(item) || map.has(item) || !isFluid(item)) continue;
    const cost = disposalCost.get(item);
    if (!cost) stages += 100;
    else {
      stages += cost.stages;
      frac += amount * cost.frac;
    }
  }
  for (const [item, amount] of rawDemand) if (RAW.has(item)) frac += amount / raw[item].perMin;
  return { stages, frac, raw: [...rawDemand.keys()].filter((i) => RAW.has(i)).length };
}

const ORDERINGS: ((a: Score, b: Score) => number)[] = [
  (a, b) => a.stages - b.stages || a.frac - b.frac || a.raw - b.raw,
  (a, b) => a.frac - b.frac || a.stages - b.stages || a.raw - b.raw,
  (a, b) => a.raw - b.raw || a.stages - b.stages || a.frac - b.frac,
];
const KEEP_PER_ORDERING = 5;
const MAX_PARTIALS = 40;

function prune(cands: Cand[]): Cand[] {
  const keep = new Map<string, Cand>();
  for (const cmp of ORDERINGS) {
    const sorted = [...cands].sort((a, b) => cmp(a, b) || a.key.localeCompare(b.key));
    for (const c of sorted.slice(0, KEEP_PER_ORDERING)) keep.set(c.key, c);
  }
  return [...keep.values()].sort((a, b) => ORDERINGS[0](a, b) || a.key.localeCompare(b.key));
}

// Union of two closed assignments. On a conflict the first argument wins for the
// contested items, which keeps the result closed and acyclic. Items orphaned by the
// override are dropped later by `reachable`.
function merge(a: Map<string, string>, b: Map<string, string>): Map<string, string> {
  const out = new Map(b);
  for (const [k, v] of a) out.set(k, v);
  return out;
}

function reachable(root: string, map: Map<string, string>): Map<string, string> {
  const out = new Map<string, string>();
  const visit = (item: string) => {
    if (out.has(item)) return;
    const id = map.get(item)!;
    out.set(item, id);
    for (const [ing] of recipes[id].ins) if (map.has(ing)) visit(ing);
  };
  visit(root);
  return out;
}

const mapKey = (m: Map<string, string>) => [...m.values()].sort().join("|");
const pools = new Map<string, Cand[]>();

for (let round = 0; round < 40; round++) {
  let changed = false;
  for (const [item, list] of producers) {
    const found = new Map<string, Cand>();
    for (const r of list) {
      const ings = [...new Set(r.ins.map(([i]) => i).filter((i) => !RAW.has(i)))];
      if (ings.includes(item) || ings.some((i) => !pools.get(i)?.length)) continue;
      let partials: Map<string, string>[] = [new Map()];
      for (const ing of ings) {
        const next = new Map<string, Map<string, string>>();
        for (const p of partials)
          for (const c of pools.get(ing)!)
            for (const m of [merge(p, c.map), merge(c.map, p)])
              if (!m.has(item)) next.set(mapKey(m), m);
        partials = [...next.values()].sort((a, b) => a.size - b.size).slice(0, MAX_PARTIALS);
        if (!partials.length) break;
      }
      for (const partial of partials) {
        partial.set(item, r.id);
        const p = reachable(item, partial);
        const key = mapKey(p);
        found.set(key, { map: p, key, ...score(item, p) });
      }
    }
    const pruned = prune([...found.values()]);
    const before = (pools.get(item) ?? []).map((c) => c.key).join(",");
    if (pruned.map((c) => c.key).join(",") !== before) {
      pools.set(item, pruned);
      changed = true;
    }
  }
  console.log(`round ${round + 1}: ${pools.size} items with chains`);
  if (!changed) break;
}

// Tiers come from the schematics that unlock each recipe.
const schematics = docs.find((c) => c.NativeClass.endsWith("FGSchematic'"))!.Classes;
const unlocks = new Map<string, { type: string; tier: number; name: string; cls: string }[]>();
for (const s of schematics) {
  if (s.mType === "EST_Alternate" || s.mType === "EST_HardDrive") continue;
  for (const u of s.mUnlocks ?? []) {
    if (u.Class !== "BP_UnlockRecipe_C") continue;
    for (const m of String(u.mRecipes).matchAll(/Recipe_([A-Za-z0-9_]+)_C/g)) {
      const list = unlocks.get(m[1]) ?? [];
      list.push({
        type: s.mType,
        tier: Number(s.mTechTier),
        name: s.mDisplayName,
        cls: s.ClassName,
      });
      unlocks.set(m[1], list);
    }
  }
}
const TYPE_RANK: Record<string, number> = {
  EST_Tutorial: 0,
  EST_Milestone: 1,
  EST_MAM: 2,
  EST_Custom: 3,
};
const MAM_TREES: Record<string, string> = {
  Caterium: "Caterium",
  Quartz: "Quartz",
  Sulfur: "Sulfur",
  Mycelia: "Mycelia",
  ACarapace: "Alien carapace",
  PowerSlugs: "Power slugs",
};

function groupOf(item: string): { id: string; name: string; order: number } {
  const options = (producers.get(item) ?? []).flatMap((r) => unlocks.get(r.id) ?? []);
  const best = options.sort(
    (a, b) => (TYPE_RANK[a.type] ?? 9) - (TYPE_RANK[b.type] ?? 9) || a.tier - b.tier,
  )[0];
  if (best) {
    if (best.type === "EST_Tutorial" || best.type === "EST_Milestone")
      return { id: `t${best.tier}`, name: `Tier ${best.tier}`, order: best.tier };
    if (best.type === "EST_Custom" && best.cls.startsWith("Schematic_StartingRecipes"))
      return { id: "t0", name: "Tier 0", order: 0 };
    if (best.type === "EST_MAM") {
      const tree = best.cls.split("_")[1];
      const label = MAM_TREES[tree] ?? tree;
      return { id: `mam-${tree.toLowerCase()}`, name: `MAM · ${label}`, order: 100 };
    }
  }
  return { id: "other", name: "Other", order: 200 };
}

// Listed items: storable parts that other recipes consume and that have a chain.
const consumed = new Set(Object.values(recipes).flatMap((r) => r.ins.map(([i]) => i)));
const skipped: string[] = [];
const listed: { id: string; name: string; group: ReturnType<typeof groupOf> }[] = [];
for (const [id, info] of Object.entries(parts)) {
  if (info.isFluid || info.isFicsmas || RAW.has(id) || !consumed.has(id) || !producers.has(id))
    continue;
  if (!pools.get(id)?.length) {
    skipped.push(info.name);
    continue;
  }
  listed.push({ id, name: info.name, group: groupOf(id) });
}
listed.sort(
  (a, b) =>
    a.group.order - b.group.order ||
    a.group.name.localeCompare(b.group.name) ||
    a.name.localeCompare(b.name),
);

const chains: Catalog["chains"] = {};
const ref: Catalog["ref"] = {};
const used = new Set<string>(Object.values(disposal));
for (const { id } of listed) {
  const pool = pools.get(id)!;
  chains[id] = pool.map((c) => [...c.map.values()].sort());
  ref[id] = recipes[pool[0].map.get(id)!].outs[0][1];
  for (const c of pool) for (const rid of c.map.values()) used.add(rid);
}

const items: Catalog["items"] = {};
const touch = (id: string) => {
  items[id] ??= {
    name: parts[id]?.name ?? data.items.rawResources[id]?.name ?? id,
    fluid: isFluid(id),
  };
};
const outRecipes: Record<string, Recipe> = {};
for (const rid of [...used].sort()) {
  outRecipes[rid] = recipes[rid];
  recipes[rid].ins.forEach(([i]) => touch(i));
  recipes[rid].outs.forEach(([i]) => touch(i));
}
for (const { id, group } of listed) {
  touch(id);
  items[id].group = group.id;
}

const groupList = new Map<string, { id: string; name: string; order: number }>();
for (const { group } of listed) groupList.set(group.id, group);

const usedBuildings = new Set<string>();
Object.values(outRecipes).forEach((r) => usedBuildings.add(r.building));
const buildings: Catalog["buildings"] = {};
for (const b of usedBuildings) buildings[b] = BUILDINGS[b] ?? b;
for (const r of Object.values(raw)) buildings[r.building] = r.building;

const catalog: Catalog = {
  meta: { sha: sources.sha },
  groups: [...groupList.values()]
    .sort((a, b) => a.order - b.order || a.name.localeCompare(b.name))
    .map(({ id, name }) => ({ id, name })),
  items,
  listed: listed.map((l) => l.id),
  raw,
  buildings,
  recipes: outRecipes,
  disposal,
  chains,
  ref,
};

const out = join(root, "src/data/catalog.json");
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, JSON.stringify(catalog) + "\n");
console.log(
  `listed ${listed.length} items, ${Object.keys(outRecipes).length} recipes, ${Object.values(chains).reduce((n, c) => n + c.length, 0)} chains`,
);
console.log(`no automatable chain: ${skipped.join(", ")}`);
