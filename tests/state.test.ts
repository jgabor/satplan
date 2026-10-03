import { describe, expect, it } from "vite-plus/test";
import { decodeState, emptyState, encodeState } from "../src/state.ts";

describe("state", () => {
  it("round trips every field", async () => {
    const state = {
      metric: 2 as const,
      extraction: { miner: 3 as const, purity: "normal" as const },
      built: ["IronScrew", "Computer"],
      chosen: { Computer: ["Computer", "Plastic"] },
      rates: { IronScrew: 120 },
    };
    const decoded = await decodeState(await encodeState(state));
    expect(decoded).toEqual({ ...state, built: ["Computer", "IronScrew"] });
  });

  it("omits defaults so an empty state stays small", async () => {
    const text = await encodeState(emptyState());
    expect(text.length).toBeLessThan(20);
    expect(await decodeState(text)).toEqual(emptyState());
  });

  it.each(["miner", "purity"] as const)("round trips a changed %s on its own", async (field) => {
    const state = emptyState();
    if (field === "miner") state.extraction.miner = 1;
    else state.extraction.purity = "impure";
    expect(await decodeState(await encodeState(state))).toEqual(state);
  });

  it("reads existing links with default extraction settings", async () => {
    const text = "j" + btoa(JSON.stringify({ v: 1, b: ["IronScrew"], r: { IronScrew: 120 } }));
    expect(await decodeState(text)).toEqual({
      ...emptyState(),
      built: ["IronScrew"],
      rates: { IronScrew: 120 },
    });
  });

  it.each([{ miner: 0, purity: "rich" }, { miner: "3", purity: null }, null])(
    "ignores invalid extraction settings: %j",
    async (extraction) => {
      const text = "j" + btoa(JSON.stringify({ v: 1, e: extraction }));
      expect(await decodeState(text)).toEqual(emptyState());
    },
  );

  it("uses only URL-safe characters", async () => {
    const built = Array.from({ length: 90 }, (_, i) => `Item${i}`);
    const text = await encodeState({ ...emptyState(), built });
    expect(text).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it("falls back to an empty state for damaged input", async () => {
    expect(await decodeState(null)).toEqual(emptyState());
    expect(await decodeState("zzzz")).toEqual(emptyState());
    expect(await decodeState("j!!!")).toEqual(emptyState());
  });

  it("drops invalid fields instead of failing", async () => {
    const json = JSON.stringify({ v: 1, m: 9, b: ["A", 3], o: { X: "no" }, r: { A: -1, B: 5 } });
    const bytes = new TextEncoder().encode(json);
    const text = "j" + btoa(String.fromCharCode(...bytes)).replace(/=+$/, "");
    expect(await decodeState(text)).toEqual({ ...emptyState(), built: ["A"], rates: { B: 5 } });
  });
});
