import { describe, expect, it } from "vite-plus/test";
import { rankChains } from "../src/calc.ts";
import { catalog as cat } from "../src/catalog.ts";
import { fmtMW, renderList, type RowModel } from "../src/render.ts";

function row(exact: boolean, rate = cat.ref.IronPlate): RowModel {
  const ranked = rankChains(cat, "IronPlate", rate, 0);
  return {
    id: "IronPlate",
    name: "Iron Plate",
    group: cat.items.IronPlate.group!,
    built: false,
    rate,
    defaultRate: cat.ref.IronPlate,
    customRate: rate !== cat.ref.IronPlate,
    ranked,
    selected: ranked[0],
    pinned: false,
    stale: false,
    exact,
  };
}

const totals = new Map([[cat.items.IronPlate.group!, { built: 0, total: 1 }]]);
const html = (r: RowModel) => renderList(cat, [r], totals, "IronPlate", new Set());

describe("rate controls", () => {
  it("offers building steps by default and hides the exact field", () => {
    const out = html(row(false));
    expect(out).toContain('data-step="1"');
    expect(out).toContain('data-step="-1"');
    expect(out).toContain('data-mode="exact"');
    expect(out).not.toContain("rate-input");
  });

  it("offers the exact field instead of the steps in exact mode", () => {
    const out = html(row(true));
    expect(out).toContain("rate-input");
    expect(out).toContain('data-mode="steps"');
    expect(out).not.toContain("data-step=");
  });

  it("disables stepping below one building", () => {
    expect(html(row(false))).toMatch(/data-step="-1"[^>]*disabled/);
    expect(html(row(false, cat.ref.IronPlate * 2))).not.toMatch(/data-step="-1"[^>]*disabled/);
  });
});

describe("chain list", () => {
  it("adds a column header row only to open tiers", () => {
    const r = row(false);
    expect(html(r)).toContain('class="list-head"');
    expect(renderList(cat, [r], totals, null, new Set([r.group]))).not.toContain("list-head");
  });

  it("shows deltas against the selected chain on the other chains only", () => {
    const r = row(false);
    expect(r.ranked.length).toBeGreaterThan(1);
    const out = html(r);
    const selected = out.match(/<button[^>]*class="alt selected"[\s\S]*?<\/button>/)![0];
    expect(selected).not.toContain("delta");
    expect(out.match(/class="delta /g)!.length).toBe((r.ranked.length - 1) * 3);
  });
});

describe("display polish", () => {
  it("formats power with one decimal without changing rate precision", () => {
    expect([0.483, 27.5, 20.37, 8.204].map(fmtMW)).toEqual(["0.5", "27.5", "20.4", "8.2"]);
    const r = row(false);
    expect(html(r)).toContain(`${fmtMW(r.selected.result.power)} MW`);
  });

  it("shows the final clock only when the stepper is underclocked", () => {
    expect(html(row(false, cat.ref.IronPlate * 1.5))).toMatch(
      /step-count[^>]*>2× Constructor · 75%/,
    );
    expect(html(row(false))).toMatch(/step-count[^>]*>1× Constructor<\/span>/);
  });

  it("dims shared recipe and raw names only in other chains", () => {
    const r = row(false);
    const out = html(r);
    const selected = out.match(/<button[^>]*class="alt selected"[\s\S]*?<\/button>/)![0];
    expect(selected).not.toContain('class="dim"');
    const shared = r.selected.result.stages[0].recipe;
    const alternatives = r.ranked.filter(
      (chain) =>
        chain !== r.selected && chain.result.stages.some((stage) => stage.recipe.id === shared.id),
    );
    expect(alternatives.length).toBeGreaterThan(0);
    expect(out).toContain(`<span class="dim">${shared.name}</span>`);
    expect(out).toContain('<span class="dim">Iron Ore</span>');
  });

  it("puts the pick status directly after the selected button", () => {
    const r = row(false);
    r.pickSummary = r.ranked[1].result;
    expect(html(r)).toMatch(/alt selected[\s\S]*?<\/button><p class="pick-summary">Now/);
    expect(html(r)).toContain("from the previous chain");
    r.pickSummary = r.selected.result;
    expect(html(r)).toContain("same as the previous chain");
    delete r.pickSummary;
    expect(html(r)).not.toContain('role="status"');
  });

  it("treats power differences that round to zero as unchanged", () => {
    const r = row(false);
    r.ranked[1] = {
      ...r.ranked[1],
      result: { ...r.selected.result, power: r.selected.result.power + 0.04 },
    };
    r.ranked[2] = {
      ...r.ranked[2],
      result: { ...r.selected.result, power: r.selected.result.power - 0.04 },
    };
    const out = html(r);
    expect(out).not.toMatch(/class="delta (?:better|worse)"[^>]*>[\s\S]*?[+−]0\.0/);
    expect(out).toContain('class="delta same"');
    r.pickSummary = { ...r.selected.result, power: r.selected.result.power - 0.04 };
    expect(html(r)).toContain("same as the previous chain");
    expect(html(r)).not.toContain("−0.0");
    expect(html(r)).not.toContain("+0.0");
  });

  it("keys row values, detail totals and individual stage cells", () => {
    const out = html(row(false));
    for (const key of [
      "row:recipe",
      "row:rate",
      "row:stages",
      "row:bldgs",
      "row:power",
      "row:chips",
      "count",
      "note",
      "power",
    ])
      expect(out).toContain(`data-k="IronPlate:${key}"`);
    expect(out).toMatch(/data-k="IronPlate:stage:[^"]+:1"/);
    expect(out).toContain('data-label="Out /min"');
    const alternatives = out.slice(out.indexOf('<div class="alts">'));
    expect(alternatives).not.toContain("data-k");
  });
});
