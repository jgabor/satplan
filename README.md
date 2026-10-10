# satplan

A small static site that lists self-contained Satisfactory production chains, one per storable part, with building counts and flow rates. It defaults to pure nodes and Mk.2 miners, with free raw extraction and all alternate recipes unlocked.

All state lives in the URL (`?s=…`): built items, ranking metric, miner level, node purity, unlocked tier, custom rates and chosen chains. `#ItemId` opens one item; Back closes it.

The same state is also saved to `localStorage` (`satplan:state`) on every change. A link with `?s=` always wins, so a shared link shows the sender's plan. Without one (for example a browser that opens the bare address), the saved plan is restored. Changing anything in a shared link overwrites the saved plan. Which tiers are collapsed and whether the phone options panel is open are not saved.

The headings use Roboto Condensed (700, latin subset), bundled in `src/fonts/` under the SIL Open Font License (`OFL.txt`).

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

Item icons are 64px PNGs from the same repo (`web/public/assets/game/item/`, pinned by the same `sha`; the repo collated them from [SatisfactoryTools](https://github.com/greeny/SatisfactoryTools)). They are Satisfactory game assets, © Coffee Stain Studios. `public/icons/<ItemId>.png` is committed, so builds need no network. After the catalog gains items or `sha` changes, run `vp run icons`; the test in `tests/icons.test.ts` fails when an icon is missing.

How the catalog is built:

- Only recipes that can run from extractable raw inputs are kept. FICSMAS recipes, resource conversions, and anything that needs leaves, wood, mycelia, creature parts or power slugs are dropped.
- A beam search keeps up to 15 candidate chains per item. Each chain uses one recipe per item. The pool mixes the best chains by stages, by buildings and by raw input types.
- Fluid byproducts get the simplest disposal recipe that ends in something sinkable (for example heavy oil residue into petroleum coke). Solid leftovers go to an AWESOME Sink. Raw byproducts such as water are absorbed.
- Items with no automatable chain (for example Biomass, Alien Protein and the plutonium parts) are left out. The script prints them.

`src/calc.ts` turns a chain and a target rate into buildings, clock speeds and flows. It runs in the browser and in the catalog script, so both use the same rules. Byproducts of one stage reduce demand for the same item elsewhere in the chain.

### Assumptions to know about

- Power draw is in MW. A building at clock `c` draws its 100% power times `(c/100)^1.321928`, so a stage of `n` buildings sharing a load uses `n × power × (c/100)^1.321928`. Miners draw 5, 15 and 45 MW at Mk.1, Mk.2 and Mk.3, oil extractors 40 MW and water extractors 20 MW. The Particle Accelerator, Converter and Quantum Encoder vary with load, and the data gives an average, which is what the totals use. The Resource Well Pressurizer is not counted, the same as for nitrogen extraction below. Belts, pipes and pumps are not counted.
- The tier filter ("Up to tier N") hides chains that use a recipe unlocked after tier N. A recipe is available at the earliest tier of its non-alternate schematic (MAM research counts as the tier the schematics give it) or the tier of its building, whichever is later. Buildings use their own build recipe, except that this data calls the Smelter's `SmelterBasicMk1` and the Foundry's `SmelterMk1`. Hard-drive alternates have no tier, so they wait only for their building. The filter does not check extractor or node availability, so it assumes you can reach every raw resource.
- Miner level (Mk.1, Mk.2 or Mk.3) and node purity (impure, normal or pure) apply to all chains. The defaults are Mk.2 and pure, giving 240/min per miner at 100% clock.
- Node purity also applies to oil extractors (240 m³/min on pure nodes) and nitrogen well satellites (120 m³/min on pure satellites). Normal nodes give half the pure rate; impure nodes give one quarter. Water extractors stay at 120 m³/min. The nitrogen pressurizer is not counted.
- Extractor counts use 100% clock capacity, then share the load at the displayed clock speed. Overclocking and belt limits are not modeled.
- The default target for each item is one building at 100% in the top-ranked chain. Changing the ranking metric does not change the default target.
- The item detail has two ways to set the target. The default `−`/`+` stepper moves the final stage by whole buildings (1× to 2× Constructor); a part-filled final stage rounds to a whole building on the first step. The "Exact rate" toggle swaps the stepper for a numeric `Target` field. An item opens in exact mode when its saved rate is not a whole number of final-stage buildings.

## Hooks

`npm install` runs `vp config` (the `prepare` script), which points `core.hooksPath` at `.vite-hooks/_`. The committed `.vite-hooks/pre-commit` runs `vp staged`, which runs `vp check --fix` on staged files (see `staged` in `vite.config.ts`).

## Deploy

The site is plain static files, served by Cloudflare Workers static assets (see `wrangler.jsonc`) at https://satplan.jgabor.se. R2 is not used.

Every push to `main` runs `.github/workflows/ci.yml`: `vp check`, `vp test`, `vp build`, then `wrangler deploy`. Pull requests run the checks only. The workflow needs two repository secrets:

- `CLOUDFLARE_API_TOKEN`: permissions Account › Workers Scripts: Edit, and Zone `jgabor.se` › Workers Routes: Edit and DNS: Edit.
- `CLOUDFLARE_ACCOUNT_ID`: the Cloudflare account that holds the `jgabor.se` zone.

To create or rotate the deploy token without the dashboard, put a bootstrap token in `.dev.vars` (git-ignored) as `CLOUDFLARE_API_TOKEN_BOOTSTRAP`, together with `CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_DOMAIN` (the zone name, `jgabor.se`). The bootstrap token needs Account API Tokens Write and Account Settings Read on the account, and Zone Read on the zone. Then run `node scripts/cf-token.ts`. It creates the deploy token, sets both repository secrets with `gh`, and deletes older tokens with the same name.

The route in `wrangler.jsonc` attaches `satplan.jgabor.se` as a custom domain. Wrangler creates the DNS record and certificate on the first deploy.

To deploy by hand:

```sh
vp run deploy   # vp check, vp test, vp build, then wrangler deploy
```

Wrangler runs through `vp dlx` at a pinned version (in the `deploy` task and in the CI workflow, so change both), so it is not a project dependency.
