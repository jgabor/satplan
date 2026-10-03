import { existsSync } from "node:fs";
import { describe, expect, it } from "vite-plus/test";
import { catalog } from "../src/catalog.ts";

describe("icons", () => {
  it("has an icon file for every item and raw resource", () => {
    const ids = [...Object.keys(catalog.items), ...Object.keys(catalog.raw)];
    const missing = ids.filter(
      (id) => !existsSync(new URL(`../public/icons/${id}.png`, import.meta.url)),
    );
    expect(missing, "run `vp run icons`").toEqual([]);
  });
});
