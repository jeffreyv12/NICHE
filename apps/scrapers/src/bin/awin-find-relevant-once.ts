// Fetch ALL available Awin NL programmes and show them sorted.
// Run (PowerShell):
//   Get-Content .env.local | ... ; & ".\apps\scrapers\node_modules\.bin\tsx.ps1" apps\scrapers\src\bin\awin-find-relevant-once.ts

import { AwinClient } from "../sources/awin/index.js";

const token = process.env.AWIN_API_TOKEN;
const publisherId = process.env.AWIN_PUBLISHER_ID;

if (!token || !publisherId) {
  console.error("Missing AWIN_API_TOKEN or AWIN_PUBLISHER_ID in env");
  process.exit(1);
}

const client = new AwinClient({ credentials: { apiToken: token, publisherId } });

console.log("\nAwin — alle beschikbare programma's ophalen (wereldwijd)...\n");

const raw = (await client.get(`/publishers/${publisherId}/programmes`)) as Array<
  Record<string, unknown>
>;

if (!Array.isArray(raw)) {
  console.error("Onverwacht API-antwoord:", JSON.stringify(raw).slice(0, 300));
  process.exit(1);
}

// Sort alphabetically by name
const sorted = [...raw].sort((a, b) =>
  String(a.name ?? "").localeCompare(String(b.name ?? ""), "nl"),
);

console.log(`Totaal: ${sorted.length} programma's\n`);
console.log(
  `${"ID".padEnd(8)} ${"Land".padEnd(6)} ${"Status".padEnd(12)} ${"Valuta".padEnd(8)} Naam`,
);
console.log("─".repeat(90));

for (const p of sorted) {
  const id = String(p.id ?? "").padEnd(8);
  const region = p.primaryRegion as Record<string, unknown> | undefined;
  const land = String(region?.countryCode ?? "??").padEnd(6);
  const status = String(p.status ?? p.relationship ?? "?").padEnd(12);
  const currency = String(p.currencyCode ?? "?").padEnd(8);
  const name = String(p.name ?? "(geen naam)");
  console.log(`${id} ${land} ${status} ${currency} ${name}`);
}

console.log("\nKlaar.\n");
