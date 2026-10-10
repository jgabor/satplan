import { stepRate, type Ranked } from "./calc.ts";
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
  /** True when the detail view offers the exact rate field instead of building steps. */
  exact: boolean;
  pickSummary?: Result;
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

export const fmtMW = (n: number) => n.toFixed(1);

const itemName = (cat: Catalog, id: string) => cat.items[id]?.name ?? cat.raw[id]?.name ?? id;
const buildingName = (cat: Catalog, id: string) => cat.buildings[id] ?? id;

/** Item icon, sized by CSS. Files live in public/icons and are named by item id. */
const icon = (id: string, size: "lg" | "sm") =>
  `<img class="ico ico-${size}" src="/icons/${esc(id)}.png" alt="" width="${size === "lg" ? 28 : 16}" height="${size === "lg" ? 28 : 16}" loading="lazy" decoding="async">`;

/** Clock speed with a small gauge. Underclocked stages get the accent colour. */
const clock = (pct: number) =>
  `${fmt(pct)}%<span class="clock-bar${pct < 99.95 ? " under" : ""}" aria-hidden="true"><span style="width:${Math.min(pct, 100)}%"></span></span>`;

/** Signed difference from the selected chain. Lower is better for every column. */
function delta(
  diff: number,
  format: (n: number) => string = String,
  comparison: string | null = "selected",
): string {
  const same = Math.abs(diff) < 0.005 || format(Math.abs(diff)) === format(0);
  const kind = same ? "same" : diff > 0 ? "worse" : "better";
  const text = same ? "±0" : `${diff > 0 ? "+" : "−"}${format(Math.abs(diff))}`;
  return ` <span class="delta ${kind}">${comparison ? '<span class="sr">, </span>' : ""}${text}${comparison ? `<span class="sr"> compared with the ${comparison} chain</span>` : ""}</span>`;
}

/** Column labels for the rows of an open tier. Wide screens only; see style.css. */
const LIST_HEAD = `<div class="list-head" aria-hidden="true"><span class="list-cols">
  <span></span><span>Item</span><span>Final recipe</span><span class="r">Rate /min</span>
  <span class="r">Stages</span><span class="r">Bldgs</span><span class="r">MW</span><span>Raw inputs</span>
</span></div>`;

function recipeLabel(recipe: Recipe): string {
  return esc(recipe.name) + (recipe.alt ? ' <span class="tag">alt</span>' : "");
}

function finalRecipe(row: Pick<RowModel, "id" | "selected">): Recipe {
  return row.selected.result.stages.find((s) => s.kind === "make" && s.item === row.id)!.recipe;
}

/** What one final-stage building makes per minute at 100% clock. */
export const finalBase = (row: Pick<RowModel, "id" | "selected">) => finalRecipe(row).outs[0][1];

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
      <span class="recipe" data-k="${id}:row:recipe">${recipeLabel(finalRecipe(row))}${row.pinned ? ' <span class="tag pin">picked</span>' : ""}</span>
      <span class="num rate" data-k="${id}:row:rate">${fmt(row.rate)}/min</span>
      <span class="num stat stages" data-k="${id}:row:stages">${result.stageCount} <small class="unit">stages</small></span>
      <span class="num stat bldgs" data-k="${id}:row:bldgs">${result.buildings} <small class="unit">bldgs</small></span>
      <span class="num stat power" data-k="${id}:row:power">${fmtMW(result.power)} <small class="unit">MW</small></span>
      <span class="chips" data-k="${id}:row:chips">${rawChips(cat, result)}</span>
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

function renderStages(cat: Catalog, result: Result, id: string, previous?: Result): string {
  // The recipe cell has no data-k: its text is fixed by the row key, and the transient "new" tag
  // must not count as a change when it goes away.
  const previousRecipes = previous ? new Set(previous.stages.map((s) => s.recipe.id)) : null;
  let step = 0;
  const rows: string[] = [];
  for (const e of result.extractors) {
    const key = `${id}:extract:${esc(e.item)}`;
    rows.push(`<tr class="extract" data-k="${key}">
      <td class="num" data-k="${key}:1" data-label="#">${++step}</td>
      <td class="num" data-k="${key}:2" data-label="Count">${e.count}×</td>
      <td data-k="${key}:3" data-label="Building">${esc(buildingName(cat, e.building))}</td>
      <td data-k="${key}:4" data-label="Recipe">${icon(e.item, "sm")}${esc(itemName(cat, e.item))}${e.purity ? ` (${e.purity})` : ""}</td>
      <td data-k="${key}:5" data-label="In /min"></td>
      <td class="num" data-k="${key}:6" data-label="Out /min">${flows(cat, [[e.item, e.perMin]])}</td>
      <td class="num" data-k="${key}:7" data-label="Clock">${clock(e.clock)}</td>
      <td class="num" data-k="${key}:0" data-label="MW">${fmtMW(e.power)}</td></tr>`);
  }
  for (const s of result.stages) {
    const key = `${id}:stage:${esc(s.recipe.id)}`;
    rows.push(`<tr class="${s.kind}" data-k="${key}">
      <td class="num" data-k="${key}:1" data-label="#">${++step}</td>
      <td class="num" data-k="${key}:2" data-label="Count">${s.count}×</td>
      <td data-k="${key}:3" data-label="Building">${esc(buildingName(cat, s.recipe.building))}</td>
      <td data-label="Recipe">${recipeLabel(s.recipe)}${previousRecipes && s.kind === "make" && !previousRecipes.has(s.recipe.id) ? ' <span class="tag new">new</span>' : ""}${s.kind === "dispose" ? " <small>disposal</small>" : ""}</td>
      <td class="num" data-k="${key}:5" data-label="In /min">${flows(cat, s.ins)}</td>
      <td class="num" data-k="${key}:6" data-label="Out /min">${flows(cat, s.outs)}</td>
      <td class="num" data-k="${key}:7" data-label="Clock">${clock(s.clock)}</td>
      <td class="num" data-k="${key}:0" data-label="MW">${fmtMW(s.power)}</td></tr>`);
  }
  return `<div class="scroll"><table>
    <thead><tr><th>#</th><th>Count</th><th>Building</th><th>Recipe</th><th>In /min</th><th>Out /min</th><th>Clock</th><th>MW</th></tr></thead>
    <tbody>${rows.join("")}</tbody></table></div>`;
}

function renderPickSummary(now: Result, previous: Result): string {
  const changes = [
    [now.stageCount - previous.stageCount, "stages", String],
    [now.buildings - previous.buildings, "bldgs", String],
    [now.power - previous.power, "MW", fmtMW],
  ] as const;
  const parts = changes
    .filter(([diff, , format]) => Math.abs(diff) >= 0.005 && format(Math.abs(diff)) !== format(0))
    .map(([diff, label, format]) => `${delta(diff, format, null)} ${label}`);
  const oldRecipes = previous.stages.filter((s) => s.kind === "make").map((s) => s.recipe);
  const newRecipes = now.stages.filter((s) => s.kind === "make").map((s) => s.recipe);
  const oldIds = new Set(oldRecipes.map((r) => r.id));
  const newIds = new Set(newRecipes.map((r) => r.id));
  const removed = oldRecipes
    .filter((r) => !newIds.has(r.id))
    .map((r) => r.name)
    .join(", ");
  const added = newRecipes
    .filter((r) => !oldIds.has(r.id))
    .map((r) => r.name)
    .join(", ");
  const recipes =
    removed && added
      ? `Replaced ${removed} with ${added}`
      : removed
        ? `Removed ${removed}`
        : added
          ? `Added ${added}`
          : "";
  return `<p class="pick-summary">Now ${now.stageCount} stages · ${now.buildings} bldgs · ${fmtMW(now.power)} MW, ${parts.length ? parts.join(", ") + " from the previous chain" : "same as the previous chain"}.${recipes ? `<br> ${esc(recipes)}.` : ""}</p>`;
}

function renderDetail(cat: Catalog, row: RowModel): string {
  const result = row.selected.result;
  const id = esc(row.id);
  const final = result.stages.find((s) => s.kind === "make" && s.item === row.id)!;
  const building = esc(buildingName(cat, final.recipe.building));
  const rateControl = row.exact
    ? `<label class="rate-field">Target <input type="number" class="rate-input" data-id="${id}" data-fk="rate:${id}" min="0" step="any" value="${row.rate}" inputmode="decimal"> /min</label>`
    : `<span class="stepper" role="group" aria-label="Final stage buildings">
      <button type="button" class="step" data-step="-1" data-id="${id}" data-fk="step:${id}:-1" aria-label="One fewer ${building}"${stepRate(row.rate, finalBase(row), -1) === null ? " disabled" : ""}>−</button>
      <span class="step-count num" data-k="${id}:count">${fmt(final.count)}× ${building}${final.clock < 99.95 ? ` · ${fmt(final.clock)}%` : ""}</span>
      <button type="button" class="step" data-step="1" data-id="${id}" data-fk="step:${id}:1" aria-label="One more ${building}">+</button>
    </span>`;
  const rateNote = row.exact
    ? `${fmt(final.count)}× ${building} at ${fmt(final.clock)}% for the final stage`
    : `${fmt(row.rate)}/min, final stage at ${fmt(final.clock)}%`;
  const modeToggle = `<button type="button" class="link" data-mode="${row.exact ? "steps" : "exact"}" data-id="${id}" data-fk="mode:${id}">${row.exact ? "Building steps" : "Exact rate"}</button>`;
  const totals = result.totals
    .map(
      ([b, n]) =>
        `<span class="chip total" data-k="${id}:total:${esc(b)}"><b>${n}×</b> ${esc(buildingName(cat, b))}</span>`,
    )
    .join("");
  const power = `<span class="chip total" data-k="${id}:power"><b>${fmtMW(result.power)} MW</b> power</span>`;
  const sinks = result.sinks
    .map(([item, n]) => `${fmt(n)}/min ${esc(itemName(cat, item))}`)
    .join(", ");
  const base = row.selected.result;
  const sharedRecipes = new Set(base.stages.map((s) => s.recipe.id));
  const sharedRaw = new Set(base.extractors.map((e) => e.item));
  const alternatives = row.ranked
    .map((r, index) => {
      const isSelected = r === row.selected;
      const names = r.result.stages
        .filter((s) => s.kind === "make")
        .map(
          (s) =>
            `<span${!isSelected && sharedRecipes.has(s.recipe.id) ? ' class="dim"' : ""}>${esc(s.recipe.name)}</span>`,
        )
        .join(" · ");
      const d = (diff: number, format?: (n: number) => string) =>
        isSelected ? "" : delta(diff, format);
      const raws = r.result.extractors
        .map(
          (e) =>
            `<span${!isSelected && sharedRaw.has(e.item) ? ' class="dim"' : ""}>${esc(itemName(cat, e.item))}</span>`,
        )
        .join(", ");
      return `<button type="button" class="alt${isSelected ? " selected" : ""}" data-pick="${id}" data-index="${index}" data-fk="pick:${id}:${index}" aria-pressed="${isSelected}">
        <span class="num">${r.result.stageCount}<span class="sr"> stages</span>${d(r.result.stageCount - base.stageCount)}</span>
        <span class="num">${r.result.buildings}<span class="sr"> buildings</span>${d(r.result.buildings - base.buildings)}</span>
        <span class="num">${fmtMW(r.result.power)} MW${d(r.result.power - base.power, fmtMW)}</span>
        <span class="alt-raw">${raws}${r.result.unresolved.length ? ' · <span class="warn">stuck byproduct</span>' : ""}</span>
        <span class="alt-names">${index === 0 ? '<span class="tag">best</span> ' : ""}${names}</span>
      </button>${isSelected && row.pickSummary ? renderPickSummary(base, row.pickSummary) : ""}`;
    })
    .join("");
  return `
<div class="detail">
  <div class="controls">
    ${rateControl}
    ${modeToggle}
    ${row.customRate ? `<button type="button" class="link" data-reset-rate="${id}" data-fk="reset:${id}">Reset to ${fmt(row.defaultRate)}/min</button>` : `<span class="note dim">Default: one building at 100%</span>`}
    <span class="note rate-note" data-k="${id}:note">${rateNote}</span>
  </div>
  <div class="totals">${totals}${power}</div>
  ${renderStages(cat, result, id, row.pickSummary)}
  ${sinks ? `<p class="sink">Send to an AWESOME Sink: ${sinks}</p>` : ""}
  ${row.stale ? '<p class="warn">Your saved chain is no longer available. Showing the best chain.</p>' : ""}
  <h3>Chains <small>${row.ranked.length}, best first</small></h3>
  <div class="alts-head" aria-hidden="true"><span>Stages</span><span>Buildings</span><span>Power draw</span></div>
  <div class="alts">${alternatives}</div>
</div>`;
}

/** Visible chains and the items excluded by the unlocked tier. */
export function listStatus(
  shown: number,
  unlocked: number,
  total: number,
  tier: number | null,
  changed = 0,
): string {
  let text = `${shown} of ${total} chains`;
  if (tier !== null && unlocked < total)
    text += ` · ${total - unlocked} not unlocked by tier ${tier}`;
  if (changed) text += ` · chain changed for ${changed} ${changed === 1 ? "item" : "items"}`;
  return text;
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
    const pct = t.total ? (t.built / t.total) * 100 : 0;
    out.push(
      `<section class="group"><h2><button type="button" class="fold-head" data-fold="${id}" data-fk="fold:${id}" aria-expanded="${open}"><span>${esc(group.name)}</span> <span class="gauge" aria-hidden="true"><span style="width:${pct}%"></span></span><span class="num">${t.built}/${t.total}</span></button></h2>`,
    );
    if (open) {
      out.push(LIST_HEAD);
      for (const row of inGroup) out.push(renderRow(cat, row, row.id === openId));
    }
    out.push("</section>");
  }
  return out.join("");
}
