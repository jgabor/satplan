import { describe, expect, it } from "vite-plus/test";
import { evaluate, rankChains } from "../src/calc.ts";
import { catalog as cat } from "../src/catalog.ts";
import type { Catalog } from "../src/types.ts";

describe("evaluate", () => {
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
