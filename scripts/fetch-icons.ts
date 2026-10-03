// Downloads one 64px icon per catalog item into public/icons/<ItemId>.png.
// Usage: node scripts/fetch-icons.ts [--fetch]
// The icons come from the same pinned Satisfactory Factories commit as the recipe data.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Catalog } from "../src/types.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const sources = JSON.parse(readFileSync(join(root, "data/sources.json"), "utf8"));
const catalog: Catalog = JSON.parse(readFileSync(join(root, "src/data/catalog.json"), "utf8"));
const outDir = join(root, "public/icons");
const force = process.argv.includes("--fetch");

// The upstream files are named after the display name, for example "Iron Plate" -> iron-plate.
const slug = (name: string) =>
  name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

const names: Record<string, string> = {};
for (const [id, item] of Object.entries(catalog.items)) names[id] = item.name;
for (const [id, item] of Object.entries(catalog.raw)) names[id] = item.name;

mkdirSync(outDir, { recursive: true });
const todo = Object.entries(names).filter(
  ([id]) => force || !existsSync(join(outDir, `${id}.png`)),
);
const failed: string[] = [];

async function download([id, name]: [string, string]) {
  const url = `https://raw.githubusercontent.com/${sources.repo}/${sources.sha}/${sources.icons}/${slug(name)}_64.png`;
  const response = await fetch(url);
  if (!response.ok) {
    failed.push(`${id}: ${url} (${response.status})`);
    return;
  }
  writeFileSync(join(outDir, `${id}.png`), Buffer.from(await response.arrayBuffer()));
}

for (let i = 0; i < todo.length; i += 8) await Promise.all(todo.slice(i, i + 8).map(download));

console.log(
  `${todo.length - failed.length} downloaded, ${Object.keys(names).length - todo.length} cached`,
);
if (failed.length) {
  console.error(`missing:\n${failed.join("\n")}`);
  process.exitCode = 1;
}
