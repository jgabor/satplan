# satplan

A small static site that lists self-contained Satisfactory production chains, one per storable part, with building counts and flow rates. It assumes pure nodes, free raw extraction and all alternate recipes unlocked.

All state lives in the URL (`?s=…`): built items, ranking metric, custom rates and chosen chains. `#ItemId` opens one item.

## Develop

Everything runs through `vp` (Vite+ 1.0). Node comes from `.node-version`, and `vp` downloads it when needed. The package manager is the npm that ships with that Node: `vp` picks npm because `package-lock.json` exists and nothing else declares a manager. Do not delete the lockfile, or `vp` falls back to pnpm.

```sh
vp install
vp dev        # dev server
vp test       # unit tests
vp check      # format, lint, type check
vp build      # production build into dist/
vp preview    # serve dist/ locally
```

Project tasks live in `vite.config.ts` (`run.tasks`) and run with `vp run <task>`.

## Data

Recipe data comes from [satisfactory-factories/application](https://github.com/satisfactory-factories/application), pinned to the commit in `data/sources.json`. Tiers come from the schematics in the same repo's `game-docs.json`.

`src/data/catalog.json` is generated and committed. To rebuild it:

```sh
vp run catalog          # uses data/raw/, downloads it when missing; cached
vp run catalog:fetch    # downloads the pinned files again
```

To update the data, change `sha` in `data/sources.json` and run `catalog:fetch`.

How the catalog is built:

- Only recipes that can run from extractable raw inputs are kept. FICSMAS recipes, resource conversions, and anything that needs leaves, wood, mycelia, creature parts or power slugs are dropped.
- A beam search keeps up to 15 candidate chains per item. Each chain uses one recipe per item. The pool mixes the best chains by stages, by buildings and by raw input types.
- Fluid byproducts get the simplest disposal recipe that ends in something sinkable (for example heavy oil residue into petroleum coke). Solid leftovers go to an AWESOME Sink. Raw byproducts such as water are absorbed.
- Items with no automatable chain (for example Biomass, Alien Protein and the plutonium parts) are left out. The script prints them.

`src/calc.ts` turns a chain and a target rate into buildings, clock speeds and flows. It runs in the browser and in the catalog script, so both use the same rules. Byproducts of one stage reduce demand for the same item elsewhere in the chain.

### Assumptions to know about

- Pure Mk.2 miners give 240/min, oil extractors 240 m³/min, water extractors 120 m³/min.
- Nitrogen uses one pure well satellite (120 m³/min each). The pressurizer is not counted.
- The default target for each item is one building at 100% in the top-ranked chain. Changing the ranking metric does not change the default target.

## Hooks

`npm install` runs `vp config` (the `prepare` script), which points `core.hooksPath` at `.vite-hooks/_`. The committed `.vite-hooks/pre-commit` runs `vp staged`, which runs `vp check --fix` on staged files (see `staged` in `vite.config.ts`).

## Deploy

The site is plain static files, served by Cloudflare Workers static assets (see `wrangler.jsonc`) at https://satplan.jgabor.se. R2 is not used.

Every push to `main` runs `.github/workflows/ci.yml`: `vp check`, `vp test`, `vp build`, then `wrangler deploy`. Pull requests run the checks only. The workflow needs two repository secrets:

- `CLOUDFLARE_API_TOKEN`: permissions Account › Workers Scripts: Edit, and Zone `jgabor.se` › Workers Routes: Edit and DNS: Edit.
- `CLOUDFLARE_ACCOUNT_ID`: the Cloudflare account that holds the `jgabor.se` zone.

The route in `wrangler.jsonc` attaches `satplan.jgabor.se` as a custom domain. Wrangler creates the DNS record and certificate on the first deploy.

To deploy by hand:

```sh
vp run deploy   # vp check, vp test, vp build, then wrangler deploy
```

Wrangler runs through `vp dlx` at a pinned version (in the `deploy` task and in the CI workflow, so change both), so it is not a project dependency.
