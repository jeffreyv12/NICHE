// Awin product search via productdata.awin.com
// Dit werkt ZONDER goedgekeurd te zijn bij een programma.
//
// Run (PowerShell):
//   Get-Content .env.local | ... ; & ".\apps\scrapers\node_modules\.bin\tsx.ps1" apps\scrapers\src\bin\awin-feeds-once.ts

const token = process.env.AWIN_API_TOKEN;
const publisherId = process.env.AWIN_PUBLISHER_ID;

if (!token || !publisherId) {
  console.error("Missing AWIN_API_TOKEN or AWIN_PUBLISHER_ID in env");
  process.exit(1);
}

const KEYWORDS = ["air fryer", "robot vacuum", "coffee machine"];
const COUNTRY = "NL"; // probeer ook: GB, US, DE

for (const keyword of KEYWORDS) {
  console.log(`\n── Zoeken: "${keyword}" (${COUNTRY}) ──`);

  // Awin product search endpoint
  const url = new URL("https://productdata.awin.com/datafeed/api/productSearch/");
  url.searchParams.set("apiKey", token);
  url.searchParams.set("publisherId", publisherId);
  url.searchParams.set("keyword", keyword);
  url.searchParams.set("country", COUNTRY);
  url.searchParams.set("limit", "5");

  const res = await fetch(url.toString(), {
    headers: { "User-Agent": "NicheFinder/1.0" },
  });

  console.log(`  HTTP ${res.status}`);
  const text = await res.text();
  console.log(`  Response: ${text.slice(0, 300)}`);
}

console.log("\nKlaar.\n");
