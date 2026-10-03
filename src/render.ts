import type { Ranked } from "./calc.ts";
import type { Catalog, Recipe, Result } from "./types.ts";

export type RowModel = {
  id: string;
  name: string;
  group: string;
  built: boolean;
  rate: number;
  defaultRate: number;
  customRate: boolean;
  ranked: Ranked[];
  selected: Ranked;
  /** True when the user picked a chain that is not the top-ranked one. */
  pinned: boolean;
  /** True when a saved choice no longer matches any known chain. */
  stale: boolean;
};

const ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

export const esc = (text: string) => text.replace(/[&<>"']/g, (c) => ESCAPES[c]);

export function fmt(n: number): string {
  if (n >= 100) return String(Math.round(n));
  const digits = n >= 10 ? 2 : 3;
  return String(Number(n.toFixed(digits)));
}

const itemName = (cat: Catalog, id: string) => cat.items[id]?.name ?? cat.raw[id]?.name ?? id;
const buildingName = (cat: Catalog, id: string) => cat.buildings[id] ?? id;

/** Item icon, sized by CSS. Files live in public/icons and are named by item id. */
const icon = (id: string, size: "lg" | "sm") =>
  `<img class="ico ico-${size}" src="/icons/${esc(id)}.png" alt="" width="${size === "lg" ? 28 : 16}" height="${size === "lg" ? 28 : 16}" loading="lazy" decoding="async">`;

function recipeLabel(recipe: Recipe): string {
  return esc(recipe.name) + (recipe.alt ? ' <span class="tag">alt</span>' : "");
}

function finalRecipe(row: Pick<RowModel, "id" | "selected">): Recipe {
  return row.selected.result.stages.find((s) => s.kind === "make" && s.item === row.id)!.recipe;
}

function rawChips(cat: Catalog, result: Result): string {
  return result.extractors
    .map((e) => `<span class="chip">${icon(e.item, "sm")}${esc(itemName(cat, e.item))}</span>`)
    .join("");
}

function renderRow(cat: Catalog, row: RowModel, open: boolean): string {
  const result = row.selected.result;
  const id = esc(row.id);
  return `
<div class="item${open ? " open" : ""}${row.built ? " built" : ""}" id="item-${id}" data-item="${id}">
  <div class="row">
    <label class="check"><input type="checkbox" class="built-box" data-id="${id}" data-fk="built:${id}"${row.built ? " checked" : ""} aria-label="Mark ${esc(row.name)} as built"></label>
    <button type="button" class="main" data-toggle="${id}" data-fk="toggle:${id}" aria-expanded="${open}">
      ${icon(row.id, "lg")}
      <span class="name">${esc(row.name)}</span>
      <span class="recipe">${recipeLabel(finalRecipe(row))}${row.pinned ? ' <span class="tag pin">picked</span>' : ""}</span>
      <span class="num rate">${fmt(row.rate)}/min</span>
      <span class="num stat stages">${result.stageCount} <small>stages</small></span>
      <span class="num stat bldgs">${result.buildings} <small>bldgs</small></span>
      <span class="num stat power">${fmt(result.power)} <small>MW</small></span>
      <span class="chips">${rawChips(cat, result)}</span>
    </button>
  </div>
  ${open ? renderDetail(cat, row) : ""}
</div>`;
}

function flows(cat: Catalog, list: [string, number, ("main" | "by")?][]): string {
  return list
    .map(
      ([item, perMin, kind]) =>
        `<div class="${kind === "by" ? "by" : ""}">${fmt(perMin)} ${icon(item, "sm")}${esc(itemName(cat, item))}${kind === "by" ? " <small>byproduct</small>" : ""}</div>`,
    )
    .join("");
}

function renderStages(cat: Catalog, result: Result): string {
  let step = 0;
  const rows: string[] = [];
  for (const e of result.extractors) {
    rows.push(`<tr class="extract">
      <td class="num">${++step}</td>
      <td class="num">${e.count}×</td>
      <td>${esc(buildingName(cat, e.building))}</td>
      <td>${icon(e.item, "sm")}${esc(itemName(cat, e.item))}${e.purity ? ` (${e.purity})` : ""}</td>
      <td></td>
      <td class="num">${flows(cat, [[e.item, e.perMin]])}</td>
      <td class="num">${fmt(e.clock)}%</td>
      <td class="num">${fmt(e.power)}</td></tr>`);
  }
  for (const s of result.stages) {
    rows.push(`<tr class="${s.kind}">
      <td class="num">${++step}</td>
      <td class="num">${s.count}×</td>
      <td>${esc(buildingName(cat, s.recipe.building))}</td>
      <td>${recipeLabel(s.recipe)}${s.kind === "dispose" ? " <small>disposal</small>" : ""}</td>
      <td class="num">${flows(cat, s.ins)}</td>
      <td class="num">${flows(cat, s.outs)}</td>
      <td class="num">${fmt(s.clock)}%</td>
      <td class="num">${fmt(s.power)}</td></tr>`);
  }
  return `<div class="scroll"><table>
    <thead><tr><th>#</th><th>Count</th><th>Building</th><th>Recipe</th><th>In /min</th><th>Out /min</th><th>Clock</th><th>MW</th></tr></thead>
    <tbody>${rows.join("")}</tbody></table></div>`;
}

function renderDetail(cat: Catalog, row: RowModel): string {
  const result = row.selected.result;
  const id = esc(row.id);
  const final = result.stages.find((s) => s.kind === "make" && s.item === row.id)!;
  const totals = result.totals
    .map(([b, n]) => `<span class="chip total"><b>${n}×</b> ${esc(buildingName(cat, b))}</span>`)
    .join("");
  const power = `<span class="chip total"><b>${fmt(result.power)} MW</b> power</span>`;
  const sinks = result.sinks
    .map(([item, n]) => `${fmt(n)}/min ${esc(itemName(cat, item))}`)
    .join(", ");
  const alternatives = row.ranked
    .map((r, index) => {
      const names = r.result.stages
        .filter((s) => s.kind === "make")
        .map((s) => esc(s.recipe.name))
        .join(" · ");
      const isSelected = r === row.selected;
      const raws = r.result.extractors.map((e) => esc(itemName(cat, e.item))).join(", ");
      return `<button type="button" class="alt${isSelected ? " selected" : ""}" data-pick="${id}" data-index="${index}" data-fk="pick:${id}:${index}" aria-pressed="${isSelected}">
        <span class="alt-stats num">${r.result.stageCount} stages · ${r.result.buildings} bldgs · ${fmt(r.result.power)} MW</span>
        <span class="alt-raw">${raws}${r.result.unresolved.length ? ' · <span class="warn">stuck byproduct</span>' : ""}</span>
        <span class="alt-names">${index === 0 ? '<span class="tag">best</span> ' : ""}${names}</span>
      </button>`;
    })
    .join("");
  return `
<div class="detail">
  <div class="controls">
    <label class="rate-field">Target <input type="number" class="rate-input" data-id="${id}" data-fk="rate:${id}" min="0" step="any" value="${row.rate}" inputmode="decimal"> /min</label>
    <span class="note">${fmt(final.count)}× ${esc(buildingName(cat, final.recipe.building))} at ${fmt(final.clock)}% for the final stage</span>
    ${row.customRate ? `<button type="button" class="link" data-reset-rate="${id}" data-fk="reset:${id}">Reset to ${fmt(row.defaultRate)}/min</button>` : `<span class="note dim">Default: one building at 100%</span>`}
  </div>
  <div class="totals">${totals}${power}</div>
  ${renderStages(cat, result)}
  ${sinks ? `<p class="sink">Send to an AWESOME Sink: ${sinks}</p>` : ""}
  ${row.stale ? '<p class="warn">Your saved chain is no longer available. Showing the best chain.</p>' : ""}
  <h3>Chains <small>${row.ranked.length}, best first</small></h3>
  <div class="alts">${alternatives}</div>
</div>`;
}

export function renderList(
  cat: Catalog,
  rows: RowModel[],
  totals: Map<string, { built: number; total: number }>,
  openId: string | null,
  collapsed: ReadonlySet<string>,
): string {
  if (!rows.length) return '<p class="empty">No chains match.</p>';
  const out: string[] = [];
  for (const group of cat.groups) {
    const inGroup = rows.filter((r) => r.group === group.id);
    if (!inGroup.length) continue;
    const t = totals.get(group.id)!;
    const id = esc(group.id);
    const open = !collapsed.has(group.id);
    out.push(
      `<section class="group"><h2><button type="button" class="fold-head" data-fold="${id}" data-fk="fold:${id}" aria-expanded="${open}"><span>${esc(group.name)}</span> <span class="num">${t.built}/${t.total}</span></button></h2>`,
    );
    if (open) for (const row of inGroup) out.push(renderRow(cat, row, row.id === openId));
    out.push("</section>");
  }
  return out.join("");
}
