import { defineConfig } from "vite-plus";

export default defineConfig({
  staged: { "*.{ts,json,jsonc,css,html,md}": "vp check --fix" },
  fmt: { ignorePatterns: ["src/data/catalog.json", "data/raw/**", "package-lock.json"] },
  lint: {
    jsPlugins: [{ name: "vite-plus", specifier: "vite-plus/oxlint-plugin" }],
    rules: { "vite-plus/prefer-vite-plus-imports": "error" },
    options: { typeAware: true, typeCheck: true },
  },
  run: {
    tasks: {
      // Cached: reruns only when the script, its inputs or data/raw change.
      catalog: "node scripts/build-catalog.ts",
      "catalog:fetch": { command: "node scripts/build-catalog.ts --fetch", cache: false },
      // Icons are committed. Run this after the catalog gains items or the pinned sha changes.
      icons: { command: "node scripts/fetch-icons.ts", cache: false },
      // Wrangler runs through dlx at a pinned version, so it adds no dependency.
      deploy: {
        command: ["vp check", "vp test", "vp build", "vp dlx wrangler@4.146.0 deploy"],
        cache: false,
      },
    },
  },
});
