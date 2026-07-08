// Quick connectivity check: list joined Awin programmes for NL.
// Run: pnpm --filter @nichefinder/scrapers exec tsx src/bin/awin-check-once.ts

import { AwinClient, listProgrammes } from "../sources/awin/index.js";

const token = process.env.AWIN_API_TOKEN;
const publisherId = process.env.AWIN_PUBLISHER_ID;

if (!token || !publisherId) {
  console.error("Missing AWIN_API_TOKEN or AWIN_PUBLISHER_ID in env");
  process.exit(1);
}

const client = new AwinClient({ credentials: { apiToken: token, publisherId } });

console.log(`\nAwin publisher ${publisherId} — checking programmes...\n`);

const joined = await listProgrammes(client, { relationship: "joined", countryCode: "NL" });
const pending = await listProgrammes(client, { relationship: "pending", countryCode: "NL" });

if (joined.length === 0 && pending.length === 0) {
  console.log("No NL programmes joined or pending yet.");
} else {
  if (joined.length > 0) {
    console.log(`✓ Joined (${joined.length}):`);
    for (const p of joined) {
      console.log(
        `  - ${p.name ?? "(geen naam)"} (id=${p.id}) | regio: ${p.primaryRegion?.countryCode ?? "?"} | valuta: ${p.currencyCode ?? "?"}`,
      );
    }
  }
  if (pending.length > 0) {
    console.log(`\n⏳ In behandeling (${pending.length}):`);
    for (const p of pending) {
      console.log(`  - ${p.name} (id=${p.id})`);
    }
  }
}

console.log("\n✓ Token werkt.\n");
