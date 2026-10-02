import json from "./data/catalog.json";
import type { Catalog } from "./types.ts";

// JSON imports widen tuples to arrays, so the cast goes through unknown.
export const catalog = json as unknown as Catalog;
