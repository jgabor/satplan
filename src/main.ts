import "./style.css";
import { METRICS, rankChains, recipeTiers, type Metric } from "./calc.ts";
import { catalog as cat } from "./catalog.ts";
import { esc, renderList, type RowModel } from "./render.ts";
import { buildUrl, readState, saveState, type State } from "./state.ts";
import type { Extraction } from "./types.ts";

const listedSet = new Set(cat.listed);

const $ = <T extends HTMLElement>(selector: string) => document.querySelector<T>(selector)!;
const listEl = $<HTMLDivElement>("#list");
const searchEl = $<HTMLInputElement>("#q");
const metricEl = $<HTMLSelectElement>("#metric");
const minerEl = $<HTMLSelectElement>("#miner");
const purityEl = $<HTMLSelectElement>("#purity");
const tierEl = $<HTMLSelectElement>("#tier");
const todoEl = $<HTMLInputElement>("#todo");
const copyEl = $<HTMLButtonElement>("#copy");
const linkBox = $<HTMLInputElement>("#link-box");
const countEl = $<HTMLElement>("#count");
const barEl = $<HTMLElement>("#bar");
const statusEl = $<HTMLElement>("#status");
const foldEl = $<HTMLButtonElement>("#fold");
const optionsEl = $<HTMLButtonElement>("#options");
const topEl = $<HTMLElement>(".top");

let state: State;
let openId: string | null = null;
let query = "";
let onlyTodo = false;
const collapsed = new Set<string>();
// A null entry means no chain is unlocked at the chosen tier.
const cache = new Map<string, RowModel | null>();

const chainKey = (ids: string[]) => [...ids].sort().join("|");

function rowFor(id: string): RowModel | null {
  const cached = cache.get(id);
  if (cached !== undefined) return cached;

  const defaultRate = cat.ref[id];
  const customRate = id in state.rates;
  const rate = state.rates[id] ?? defaultRate;
  const saved = state.chosen[id];
  const ranked = rankChains(
    cat,
    id,
    rate,
    state.metric,
    saved ? [saved] : [],
    state.extraction,
    state.tier,
  );
  if (!ranked.length) {
    cache.set(id, null);
    return null;
  }
  const match = saved ? ranked.find((r) => chainKey(r.ids) === chainKey(saved)) : undefined;
  const selected = match ?? ranked[0];
  const row: RowModel = {
    id,
    name: cat.items[id].name,
    group: cat.items[id].group!,
    built: state.built.includes(id),
    rate,
    defaultRate,
    customRate,
    ranked,
    selected,
    pinned: !!match && match !== ranked[0],
    stale: !!saved && !match,
  };
  cache.set(id, row);
  return row;
}

function haystack(row: RowModel): string {
  const parts = [row.name, cat.groups.find((g) => g.id === row.group)!.name];
  for (const s of row.selected.result.stages) parts.push(s.recipe.name);
  for (const e of row.selected.result.extractors) parts.push(cat.raw[e.item].name);
  return parts.join(" ").toLowerCase();
}

function render() {
  const all = cat.listed.map(rowFor).filter((r): r is RowModel => r !== null);
  const builtTotal = all.filter((r) => r.built).length;
  countEl.innerHTML = `<b>${builtTotal}</b> / ${all.length} built`;
  barEl.style.width = `${(builtTotal / all.length) * 100}%`;

  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  const rows = all.filter(
    (r) => (!onlyTodo || !r.built) && words.every((w) => haystack(r).includes(w)),
  );
  const totals = new Map<string, { built: number; total: number }>();
  for (const r of all) {
    const t = totals.get(r.group) ?? { built: 0, total: 0 };
    t.total++;
    if (r.built) t.built++;
    totals.set(r.group, t);
  }
  statusEl.textContent = `${rows.length} of ${all.length} chains`;

  // Matches inside a collapsed tier would be hidden, so a search shows every tier.
  const searching = words.length > 0;
  foldEl.hidden = searching;
  foldEl.textContent = collapsed.size < cat.groups.length ? "Collapse all" : "Expand all";

  const focusKey = (document.activeElement as HTMLElement | null)?.dataset.fk;
  listEl.innerHTML = renderList(cat, rows, totals, openId, searching ? new Set() : collapsed);
  if (focusKey && listEl.contains(document.activeElement) === false) {
    listEl.querySelector<HTMLElement>(`[data-fk="${CSS.escape(focusKey)}"]`)?.focus({
      preventScroll: true,
    });
  }
}

function commit(changed?: string) {
  if (changed) cache.delete(changed);
  else cache.clear();
  void saveState(state);
  render();
}

function setOpen(id: string | null) {
  openId = id;
  history.replaceState(
    null,
    "",
    id ? `#${encodeURIComponent(id)}` : location.pathname + location.search,
  );
  render();
  if (id) document.getElementById(`item-${id}`)?.scrollIntoView({ block: "nearest" });
}

listEl.addEventListener("click", (event) => {
  const target = event.target as HTMLElement;
  const fold = target.closest<HTMLElement>("[data-fold]");
  if (fold) {
    const id = fold.dataset.fold!;
    if (collapsed.delete(id)) {
      render();
    } else {
      collapsed.add(id);
      // An open row inside the tier would vanish while its hash stayed in the address bar.
      if (openId && cat.items[openId].group === id) setOpen(null);
      else render();
    }
    return;
  }
  const toggle = target.closest<HTMLElement>("[data-toggle]");
  if (toggle) {
    const id = toggle.dataset.toggle!;
    setOpen(openId === id ? null : id);
    return;
  }
  const pick = target.closest<HTMLElement>("[data-pick]");
  if (pick) {
    const id = pick.dataset.pick!;
    const row = rowFor(id)!;
    const chosen = row.ranked[Number(pick.dataset.index)];
    if (chosen === row.ranked[0]) delete state.chosen[id];
    else state.chosen[id] = chosen.ids;
    commit(id);
    return;
  }
  const reset = target.closest<HTMLElement>("[data-reset-rate]");
  if (reset) {
    const id = reset.dataset.resetRate!;
    delete state.rates[id];
    delete state.chosen[id];
    commit(id);
  }
});

listEl.addEventListener("change", (event) => {
  const target = event.target as HTMLInputElement;
  const id = target.dataset.id;
  if (!id) return;
  if (target.classList.contains("built-box")) {
    state.built = target.checked ? [...state.built, id] : state.built.filter((b) => b !== id);
    commit(id);
  } else if (target.classList.contains("rate-input")) {
    const value = Number(target.value);
    if (Number.isFinite(value) && value > 0 && value !== cat.ref[id]) state.rates[id] = value;
    else delete state.rates[id];
    commit(id);
  }
});

foldEl.addEventListener("click", () => {
  if (collapsed.size < cat.groups.length) {
    for (const group of cat.groups) collapsed.add(group.id);
    setOpen(null);
  } else {
    collapsed.clear();
    render();
  }
});

optionsEl.addEventListener("click", () => {
  const open = topEl.classList.toggle("options-open");
  optionsEl.setAttribute("aria-expanded", String(open));
});

searchEl.addEventListener("input", () => {
  query = searchEl.value;
  render();
});

metricEl.addEventListener("change", () => {
  state.metric = Number(metricEl.value) as Metric;
  commit();
});

minerEl.addEventListener("change", () => {
  state.extraction.miner = Number(minerEl.value) as Extraction["miner"];
  commit();
});

tierEl.addEventListener("change", () => {
  state.tier = tierEl.value === "" ? null : Number(tierEl.value);
  commit();
});

purityEl.addEventListener("change", () => {
  state.extraction.purity = purityEl.value as Extraction["purity"];
  commit();
});

todoEl.addEventListener("change", () => {
  onlyTodo = todoEl.checked;
  render();
});

copyEl.addEventListener("click", async () => {
  const url = await buildUrl(state, openId ? `#${encodeURIComponent(openId)}` : "");
  try {
    await navigator.clipboard.writeText(url);
    copyEl.textContent = "Copied";
    setTimeout(() => (copyEl.textContent = "Copy link"), 1500);
  } catch {
    // Some embedded browsers block clipboard access, so offer the text to copy by hand.
    linkBox.value = url;
    linkBox.hidden = false;
    linkBox.select();
  }
});

document.addEventListener("keydown", (event) => {
  const typing = ["INPUT", "SELECT", "TEXTAREA"].includes((event.target as HTMLElement).tagName);
  if (event.key === "/" && !typing) {
    event.preventDefault();
    searchEl.focus();
    searchEl.select();
  } else if (event.key === "Escape") {
    if (document.activeElement === searchEl && searchEl.value) {
      searchEl.value = "";
      query = "";
      render();
    } else if (openId) {
      setOpen(null);
    }
  }
});

async function init() {
  state = await readState();
  state.built = state.built.filter((id) => listedSet.has(id));
  minerEl.value = String(state.extraction.miner);
  purityEl.value = state.extraction.purity;
  tierEl.innerHTML =
    '<option value="">All tiers</option>' +
    recipeTiers(cat)
      .map((t) => `<option value="${t}">Up to tier ${t}</option>`)
      .join("");
  tierEl.value = state.tier === null ? "" : String(state.tier);
  metricEl.innerHTML = METRICS.map(
    (m) =>
      `<option value="${m.id}"${m.id === state.metric ? " selected" : ""}>${esc(m.label)}</option>`,
  ).join("");
  $("#source").textContent = cat.meta.sha.slice(0, 7);
  const hash = decodeURIComponent(location.hash.slice(1));
  if (listedSet.has(hash)) openId = hash;
  render();
  document.body.classList.add("ready");
  if (openId) document.getElementById(`item-${openId}`)?.scrollIntoView({ block: "start" });
}

void init();
