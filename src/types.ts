export type Recipe = {
  id: string;
  name: string;
  alt: boolean;
  building: string;
  /** Power draw of one building at 100% clock, in MW. Variable-power buildings use their average. */
  power: number;
  /** Tier that unlocks the recipe and its building. Hard-drive alternates only wait for the building. */
  tier: number;
  /** Ingredients: item id and amount per minute at 100% clock. */
  ins: [item: string, perMin: number][];
  /** Products at 100% clock. The first entry is the main product, the rest are byproducts. */
  outs: [item: string, perMin: number][];
};

export type RawResource = {
  name: string;
  /** Output of one extractor on a pure node, per minute. */
  perMin: number;
  building: string;
  /** Power draw of one extractor at 100% clock, in MW. Miners are listed at Mk.2. */
  power: number;
};

export type Extraction = {
  miner: 1 | 2 | 3;
  purity: "impure" | "normal" | "pure";
};

export type ItemInfo = {
  name: string;
  fluid: boolean;
  /** Group id. Only set for listed items. */
  group?: string;
};

export type Catalog = {
  meta: { sha: string };
  groups: { id: string; name: string }[];
  items: Record<string, ItemInfo>;
  /** Listed item ids in display order (grouped, then by name). */
  listed: string[];
  raw: Record<string, RawResource>;
  /** Building id to display name. */
  buildings: Record<string, string>;
  recipes: Record<string, Recipe>;
  /** Leftover fluid item id to the recipe that turns it into something sinkable. */
  disposal: Record<string, string>;
  /** Listed item id to candidate chains. Each chain is a list of recipe ids. */
  chains: Record<string, string[][]>;
  /** Listed item id to its default target rate per minute. */
  ref: Record<string, number>;
};

export type Stage = {
  recipe: Recipe;
  kind: "make" | "dispose";
  /** Main product for "make" stages, the disposed item for "dispose" stages. */
  item: string;
  /** Fractional number of buildings at 100% clock. */
  runs: number;
  count: number;
  /** Clock speed in percent when `count` buildings share the load. */
  clock: number;
  ins: [item: string, perMin: number][];
  outs: [item: string, perMin: number, kind: "main" | "by"][];
  level: number;
  /** Power draw of all `count` buildings at `clock`, in MW. */
  power: number;
};

export type ExtractorLine = {
  item: string;
  perMin: number;
  building: string;
  count: number;
  clock: number;
  purity?: Extraction["purity"];
  /** Power draw of all `count` extractors at `clock`, in MW. */
  power: number;
};

export type Result = {
  rate: number;
  stages: Stage[];
  extractors: ExtractorLine[];
  totals: [building: string, count: number][];
  buildings: number;
  /** Total power draw of every stage and extractor, in MW. */
  power: number;
  stageCount: number;
  rawTypes: number;
  sinks: [item: string, perMin: number][];
  unresolved: string[];
};
