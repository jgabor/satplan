import { DEFAULT_EXTRACTION, type Metric } from "./calc.ts";
import type { Extraction } from "./types.ts";

export type State = {
  metric: Metric;
  extraction: Extraction;
  /** Highest unlocked tier, or null when every tier counts as unlocked. */
  tier: number | null;
  /** Item ids marked as built. */
  built: string[];
  /** Item id to the recipe ids of the chain picked by the user. */
  chosen: Record<string, string[]>;
  /** Item id to a custom target rate per minute. */
  rates: Record<string, number>;
};

export const emptyState = (): State => ({
  metric: 0,
  extraction: { ...DEFAULT_EXTRACTION },
  tier: null,
  built: [],
  chosen: {},
  rates: {},
});

const VERSION = 1;
// Any number above the highest real tier is damage, not a setting.
const MAX_TIER = 20;
// Prefix tells the decoder how the payload was packed, so links keep working
// in browsers without CompressionStream.
const PACKED = "z";
const PLAIN = "j";

type Wire = {
  v: number;
  m?: number;
  b?: string[];
  o?: Record<string, string[]>;
  r?: Record<string, number>;
  e?: Partial<Extraction>;
  t?: number;
};

function toWire(state: State): Wire {
  const wire: Wire = { v: VERSION };
  if (state.metric) wire.m = state.metric;
  if (state.built.length) wire.b = [...state.built].sort();
  if (Object.keys(state.chosen).length) wire.o = state.chosen;
  if (Object.keys(state.rates).length) wire.r = state.rates;
  const extraction: Partial<Extraction> = {};
  if (state.extraction.miner !== DEFAULT_EXTRACTION.miner)
    extraction.miner = state.extraction.miner;
  if (state.extraction.purity !== DEFAULT_EXTRACTION.purity)
    extraction.purity = state.extraction.purity;
  if (Object.keys(extraction).length) wire.e = extraction;
  if (state.tier !== null) wire.t = state.tier;
  return wire;
}

function fromWire(value: unknown): State {
  const state = emptyState();
  if (!value || typeof value !== "object") return state;
  const wire = value as Partial<Wire>;
  if (wire.v !== VERSION) return state;
  if (wire.m === 1 || wire.m === 2 || wire.m === 3) state.metric = wire.m;
  if (Number.isInteger(wire.t) && wire.t! >= 0 && wire.t! <= MAX_TIER) state.tier = wire.t!;
  if (wire.e?.miner === 1 || wire.e?.miner === 3) state.extraction.miner = wire.e.miner;
  if (wire.e?.purity === "impure" || wire.e?.purity === "normal")
    state.extraction.purity = wire.e.purity;
  if (Array.isArray(wire.b)) state.built = wire.b.filter((id) => typeof id === "string");
  if (wire.o && typeof wire.o === "object") {
    for (const [item, ids] of Object.entries(wire.o)) {
      if (Array.isArray(ids) && ids.every((id) => typeof id === "string")) state.chosen[item] = ids;
    }
  }
  if (wire.r && typeof wire.r === "object") {
    for (const [item, rate] of Object.entries(wire.r)) {
      if (typeof rate === "number" && Number.isFinite(rate) && rate > 0) state.rates[item] = rate;
    }
  }
  return state;
}

function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

function fromBase64Url(text: string): Uint8Array {
  const padded = text.replaceAll("-", "+").replaceAll("_", "/");
  const binary = atob(padded + "=".repeat((4 - (padded.length % 4)) % 4));
  return Uint8Array.from(binary, (c) => c.charCodeAt(0));
}

async function pipe(bytes: Uint8Array, stream: CompressionStream | DecompressionStream) {
  const copy = new Uint8Array(bytes);
  const body = new Blob([copy]).stream().pipeThrough(stream);
  return new Uint8Array(await new Response(body).arrayBuffer());
}

export async function encodeState(state: State): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify(toWire(state)));
  if (typeof CompressionStream === "undefined") return PLAIN + toBase64Url(bytes);
  return PACKED + toBase64Url(await pipe(bytes, new CompressionStream("deflate-raw")));
}

/** Returns an empty state when the text is missing or damaged. */
export async function decodeState(text: string | null): Promise<State> {
  if (!text) return emptyState();
  try {
    const bytes = fromBase64Url(text.slice(1));
    const raw =
      text[0] === PACKED ? await pipe(bytes, new DecompressionStream("deflate-raw")) : bytes;
    return fromWire(JSON.parse(new TextDecoder().decode(raw)));
  } catch {
    return emptyState();
  }
}

const PARAM = "s";
const STORAGE_KEY = "satplan:state";

// Storage can be missing or throw (private mode, sandboxed frames), and the URL still works then.
function storage(): Storage | null {
  try {
    return localStorage;
  } catch {
    return null;
  }
}

/** The link wins, so a shared link shows the sender's plan. Otherwise use the last saved plan. */
export function readState(): Promise<State> {
  const fromUrl = new URL(location.href).searchParams.get(PARAM);
  let saved: string | null = null;
  try {
    saved = storage()?.getItem(STORAGE_KEY) ?? null;
  } catch {
    // Reading can fail even when the storage object exists.
  }
  return decodeState(fromUrl ?? saved);
}

async function buildUrl(state: State, hash = location.hash): Promise<string> {
  const url = new URL(location.href);
  const wire = toWire(state);
  if (Object.keys(wire).length > 1) url.searchParams.set(PARAM, await encodeState(state));
  else url.searchParams.delete(PARAM);
  url.hash = hash;
  return url.toString();
}

let pending = 0;
/** Writes the state to the address bar and to local storage. */
export function saveState(state: State): Promise<void> {
  const ticket = ++pending;
  return buildUrl(state).then((url) => {
    if (ticket !== pending) return;
    history.replaceState(null, "", url);
    const text = new URL(url).searchParams.get(PARAM);
    try {
      if (text) storage()?.setItem(STORAGE_KEY, text);
      else storage()?.removeItem(STORAGE_KEY);
    } catch {
      // A full or blocked store only loses the fallback copy.
    }
  });
}
