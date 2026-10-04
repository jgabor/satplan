import { describe, expect, it } from "vite-plus/test";
import { rankChains } from "../src/calc.ts";
import { catalog as cat } from "../src/catalog.ts";
import { renderList, type RowModel } from "../src/render.ts";

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
