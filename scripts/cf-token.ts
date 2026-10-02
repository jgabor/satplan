// Mints the CI deploy token with the bootstrap token from .dev.vars, stores it
// (and the account ID) as GitHub repo secrets, then deletes older tokens with
// the same name. The token value is never printed. Run: node scripts/cf-token.ts
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { parseEnv } from "node:util";

const REPO = "jgabor/satplan";
const TOKEN_NAME = "satplan.jgabor.se-deploy";
const API = "https://api.cloudflare.com/client/v4";

const env = parseEnv(readFileSync(new URL("../.dev.vars", import.meta.url), "utf8"));
const need = (key: string): string => {
  const value = env[key];
  if (!value) throw new Error(`${key} is missing from .dev.vars`);
  return value;
};
const bootstrap = need("CLOUDFLARE_API_TOKEN_BOOTSTRAP");
const accountId = need("CLOUDFLARE_ACCOUNT_ID");
const zoneName = need("CLOUDFLARE_DOMAIN");

type Result<T> = { success: boolean; errors: { message: string }[]; result: T };

async function cf<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${bootstrap}`, "Content-Type": "application/json" },
  });
  const body = (await res.json()) as Result<T>;
  if (!body.success) {
    throw new Error(
      `${init.method ?? "GET"} ${path}: ${body.errors.map((e) => e.message).join("; ")}`,
    );
  }
  return body.result;
}

const groups = await cf<{ id: string; name: string; scopes: string[] }[]>(
  `/accounts/${accountId}/tokens/permission_groups`,
);
const group = (name: string, scope: string): { id: string } => {
  const found = groups.find((g) => g.name === name && g.scopes.includes(scope));
  if (!found) throw new Error(`Permission group not found: ${name}`);
  return { id: found.id };
};

const zones = await cf<{ id: string }[]>(
  `/zones?name=${encodeURIComponent(zoneName)}&account.id=${accountId}`,
);
if (zones.length !== 1)
  throw new Error(`Expected one zone named ${zoneName}, found ${zones.length}`);
const zoneId = zones[0].id;

const ACCOUNT = "com.cloudflare.api.account";
const created = await cf<{ id: string; value: string }>(`/accounts/${accountId}/tokens`, {
  method: "POST",
  body: JSON.stringify({
    name: TOKEN_NAME,
    policies: [
      {
        effect: "allow",
        permission_groups: [group("Workers Scripts Write", ACCOUNT)],
        resources: { [`${ACCOUNT}.${accountId}`]: "*" },
      },
      {
        effect: "allow",
        permission_groups: [
          group("Workers Routes Write", `${ACCOUNT}.zone`),
          group("DNS Write", `${ACCOUNT}.zone`),
          group("Zone Read", `${ACCOUNT}.zone`),
        ],
        resources: { [`${ACCOUNT}.zone.${zoneId}`]: "*" },
      },
    ],
  }),
});

const setSecret = (name: string, value: string): void => {
  execFileSync("gh", ["secret", "set", name, "--repo", REPO], {
    input: value,
    stdio: ["pipe", "ignore", "inherit"],
  });
};
setSecret("CLOUDFLARE_API_TOKEN", created.value);
setSecret("CLOUDFLARE_ACCOUNT_ID", accountId);

const existing = await cf<{ id: string; name: string }[]>(
  `/accounts/${accountId}/tokens?per_page=50`,
);
for (const old of existing.filter((t) => t.name === TOKEN_NAME && t.id !== created.id)) {
  await cf(`/accounts/${accountId}/tokens/${old.id}`, { method: "DELETE" });
  console.log(`Deleted old token ${old.id}`);
}
console.log(
  `Created ${TOKEN_NAME} (${created.id}) and set CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID on ${REPO}`,
);
