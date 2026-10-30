// Tells IndexNow search engines (Bing, Yandex, Seznam, Naver) about pages
// that changed today, so new days and new "why" blurbs get recrawled fast.
// Bing's index also feeds Copilot answers.
//
// Reads data/lastmod.json, which build.js updates whenever a page's HTML
// changes. The key below is public by design: IndexNow checks it against
// the matching <key>.txt file at the site root.
//
// Usage: node scripts/indexnow.js            (submit today's changes)
//        node scripts/indexnow.js --all      (submit every page, e.g. once after a site-wide change)
//        node scripts/indexnow.js --dry-run  (list them, send nothing)
const fs = require("fs");
const path = require("path");
const https = require("https");

const HOST = "wikipop.sowin.io";
const KEY = "51a8db60979bad8a1ecc571d0e891275";
const LASTMOD_FILE = path.join(__dirname, "..", "data", "lastmod.json");

function post(body) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const req = https.request("https://api.indexnow.org/indexnow", {
      method: "POST",
      headers: { "Content-Type": "application/json; charset=utf-8", "Content-Length": Buffer.byteLength(data) },
    }, (res) => {
      let text = "";
      res.on("data", (c) => (text += c));
      res.on("end", () => resolve({ status: res.statusCode, text }));
    });
    req.on("error", reject);
    req.end(data);
  });
}

async function main() {
  const today = new Date().toISOString().slice(0, 10);
  const lastmod = JSON.parse(fs.readFileSync(LASTMOD_FILE, "utf-8"));
  const urls = Object.entries(lastmod)
    .filter(([, v]) => process.argv.includes("--all") || v.lastmod === today)
    .map(([p]) => `https://${HOST}/${p}`)
    .slice(0, 10000); // IndexNow's per-request limit

  if (urls.length === 0) {
    console.log("No pages changed today; nothing to submit.");
    return;
  }
  if (process.argv.includes("--dry-run")) {
    console.log(`Would submit ${urls.length} URLs:\n${urls.slice(0, 20).join("\n")}${urls.length > 20 ? "\n..." : ""}`);
    return;
  }
  const res = await post({ host: HOST, key: KEY, keyLocation: `https://${HOST}/${KEY}.txt`, urlList: urls });
  // 200 = received, 202 = received and key check pending.
  if (res.status !== 200 && res.status !== 202) {
    throw new Error(`IndexNow returned HTTP ${res.status}: ${res.text.slice(0, 200)}`);
  }
  console.log(`Submitted ${urls.length} changed URLs to IndexNow (HTTP ${res.status}).`);
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
