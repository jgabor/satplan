import { describe, expect, it } from "vite-plus/test";
import { evaluate, rankChains } from "../src/calc.ts";
import { catalog as cat } from "../src/catalog.ts";
import type { Catalog, Extraction } from "../src/types.ts";

describe("evaluate", () => {
  it.each([
    [1, "impure", 30],
    [1, "normal", 60],
    [1, "pure", 120],
    [2, "impure", 60],
    [2, "normal", 120],
    [2, "pure", 240],
    [3, "impure", 120],
    [3, "normal", 240],
    [3, "pure", 480],
  ] as const)("sizes Mk.%i miners on %s nodes at %i/min", (miner, purity, capacity) => {
    const result = evaluate(cat, "IronIngot", ["IngotIron"], 250, { miner, purity })!;
    const extractor = result.extractors[0];
    const count = Math.ceil(250 / capacity);
    expect(extractor).toEqual({
      item: "OreIron",
      perMin: expect.closeTo(250, 6),
      building: `Miner Mk.${miner}`,
      count,
      clock: expect.closeTo((250 / (count * capacity)) * 100, 6),
      purity,
    });
    expect(Object.fromEntries(result.totals)[`Miner Mk.${miner}`]).toBe(count);
    expect(result.buildings).toBe(count + 9);
    expect(result.stages[0].runs).toBeCloseTo(250 / 30);
  });

  it.each(["impure", "normal", "pure"] as const)(
    "applies %s purity to oil without applying the miner level",
    (purity) => {
      const result = evaluate(cat, "Plastic", ["Plastic"], 160, { miner: 1, purity })!;
      const capacity = { impure: 60, normal: 120, pure: 240 }[purity];
      expect(result.extractors[0]).toEqual({
        item: "LiquidOil",
        perMin: 240,
        building: "Oil Extractor",
        count: 240 / capacity,
        clock: 100,
        purity,
      });
    },
  );

  it("changes nitrogen satellite capacity but leaves water extraction unchanged", () => {
    const chain = ["NitricAcid", "IronPlate", "IngotIron"];
    const baseline = evaluate(cat, "NitricAcid", chain, 100)!;
    const result = evaluate(cat, "NitricAcid", chain, 100, { miner: 3, purity: "normal" })!;
    const nitrogen = result.extractors.find((e) => e.item === "NitrogenGas")!;
    expect(nitrogen.building).toBe("Well satellite (normal)");
    expect(nitrogen.count).toBe(Math.ceil(nitrogen.perMin / 60));
    expect(nitrogen.clock).toBeCloseTo((nitrogen.perMin / (nitrogen.count * 60)) * 100);
    expect(result.extractors.find((e) => e.item === "Water")).toEqual(
      baseline.extractors.find((e) => e.item === "Water"),
    );
    expect(result.extractors.find((e) => e.item === "Water")).toBeDefined();
  });

  it("uses extraction settings when ranking chains", () => {
    const extraction: Extraction = { miner: 1, purity: "impure" };
    const ranked = rankChains(cat, "IronIngot", 250, 1, [["IngotIron"]], extraction);
    const standard = ranked.find((r) => r.ids.length === 1 && r.ids[0] === "IngotIron")!;
    expect(standard.result).toEqual(evaluate(cat, "IronIngot", ["IngotIron"], 250, extraction));
    expect(standard.result.extractors[0].count).toBe(9);
    for (let i = 1; i < ranked.length; i++) {
      expect(ranked[i].result.buildings).toBeGreaterThanOrEqual(ranked[i - 1].result.buildings);
    }
  });

  it("matches the known stitched reinforced iron plate chain", () => {
    const chain = ["Alternate_ReinforcedIronPlate_2", "Alternate_Wire_1", "IronPlate", "IngotIron"];
    const result = evaluate(cat, "IronPlateReinforced", chain, 5.625)!;
    expect(result).not.toBeNull();
    expect(Object.fromEntries(result.totals)).toEqual({
      "Miner Mk.2": 1,
      smeltermk1: 2,
      constructormk1: 3,
      assemblermk1: 1,
    });
    expect(result.buildings).toBe(7);
    expect(result.stageCount).toBe(4);
    expect(result.extractors[0].perMin).toBeCloseTo(48.958, 3);
  });

  it("rejects chains with a missing stage", () => {
    expect(evaluate(cat, "IronPlateReinforced", ["Alternate_ReinforcedIronPlate_2"], 1)).toBeNull();
  });

  it("disposes of heavy oil residue from plastic", () => {
    const result = evaluate(cat, "Plastic", ["Plastic"], 20)!;
    expect(result.unresolved).toEqual([]);
    expect(result.stages.map((s) => [s.kind, s.recipe.id])).toEqual([
      ["make", "Plastic"],
      ["dispose", "PetroleumCoke"],
    ]);
    expect(result.sinks).toEqual([["PetroleumCoke", expect.closeTo(30, 6)]]);
  });

  it("sizes the disposal stage from the leftover flow", () => {
    const result = evaluate(cat, "Plastic", ["Plastic"], 20)!;
    const make = result.stages.find((s) => s.kind === "make")!;
    expect(make.clock).toBeCloseTo(100, 6);
    expect(result.stages.find((s) => s.kind === "dispose")!.runs).toBeCloseTo(0.25, 6);
  });

  it("feeds a byproduct back into the chain before disposing the rest", () => {
    const toy: Catalog = {
      ...cat,
      items: { A: { name: "A", fluid: false }, B: { name: "B", fluid: false } },
      raw: { Ore: { name: "Ore", perMin: 100, building: "Miner" } },
      recipes: {
        // Makes 10 B per minute as the main product and 10 A per minute as a byproduct.
        MakeB: {
          id: "MakeB",
          name: "Make B",
          alt: false,
          building: "x",
          ins: [["Ore", 10]],
          outs: [
            ["B", 10],
            ["A", 10],
          ],
        },
        // Plain source of A, only needed when the byproduct falls short.
        MakeA: {
          id: "MakeA",
          name: "Make A",
          alt: false,
          building: "x",
          ins: [["Ore", 10]],
          outs: [["A", 10]],
        },
        MakeT: {
          id: "MakeT",
          name: "Make T",
          alt: false,
          building: "x",
          ins: [
            ["A", 10],
            ["B", 10],
          ],
          outs: [["T", 10]],
        },
      },
      disposal: {},
    };
    const result = evaluate(toy, "T", ["MakeT", "MakeB", "MakeA"], 10)!;
    const runs = Object.fromEntries(result.stages.map((s) => [s.recipe.id, s.runs]));
    // B needs 10/min, so MakeB runs once and its A byproduct covers all of T's A demand.
    expect(runs.MakeB).toBeCloseTo(1, 6);
    expect(runs.MakeT).toBeCloseTo(1, 6);
    expect(runs.MakeA).toBeUndefined();
    expect(result.extractors[0].perMin).toBeCloseTo(10, 6);
  });
});

describe("catalog", () => {
  it("has an evaluable chain for every listed item", () => {
    for (const id of cat.listed) {
      expect(rankChains(cat, id, cat.ref[id], 0).length, id).toBeGreaterThan(0);
    }
  });

  it("gives every listed item a known group", () => {
    const groups = new Set(cat.groups.map((g) => g.id));
    for (const id of cat.listed) expect(groups.has(cat.items[id].group!), id).toBe(true);
  });

  it("never leaves a byproduct stuck in the best chain", () => {
    for (const id of cat.listed) {
      const best = rankChains(cat, id, cat.ref[id], 0)[0];
      expect(best.result.unresolved, id).toEqual([]);
    }
  });

  it("ranks by the selected metric", () => {
    const stages = rankChains(cat, "IronScrew", cat.ref.IronScrew, 0);
    const raws = rankChains(cat, "IronScrew", cat.ref.IronScrew, 2);
    for (let i = 1; i < raws.length; i++) {
      expect(raws[i].result.rawTypes).toBeGreaterThanOrEqual(raws[i - 1].result.rawTypes);
    }
    expect(stages[0].result.stageCount).toBeLessThanOrEqual(stages.at(-1)!.result.stageCount);
  });
});
