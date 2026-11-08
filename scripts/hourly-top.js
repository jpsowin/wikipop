// Fallback for late Wikimedia data: rebuild a day's top articles from the
// hourly pageview files on dumps.wikimedia.org.
//
// Wikimedia's daily "top" list sometimes shows up many hours late. The hourly
// files it's built from are published hour by hour, so when the daily list is
// missing we can add up whatever hours exist. The result has the same shape as
// fetchTopArticles() in build.js: [{ article, views, rank }], highest first.
//
// Views are English Wikipedia desktop ("en") + mobile web ("en.m"). That's
// close to, but not exactly, the daily list's "all-access" numbers, and a day
// with missing hours comes out low. build.js marks such days `provisional`
// and swaps in the official numbers once they arrive.
//
// Try it by hand:  node scripts/hourly-top.js 2026-11-07

const zlib = require("zlib");
const readline = require("readline");
const { Readable } = require("stream");

const BASE = "https://dumps.wikimedia.org/other/pageviews";
const UA = "WikiPopBot/1.0 (https://github.com/jpsowin/wikipop)";
// Only count a page in an hour when it had at least this many views then.
// Keeps memory small (millions of pages get 1-2 views an hour); a top-1000
// page loses at most a few hundred views across the day from this cut.
const MIN_HOURLY = 20;
const CONCURRENCY = 3;

function parts(dateStr) {
  const [y, m, d] = dateStr.split("-");
  return { y, m, d, compact: `${y}${m}${d}` };
}

// Names of the hourly files that exist for that UTC day, e.g. pageviews-20261107-130000.gz.
async function listHourFiles(dateStr) {
  const { y, m, compact } = parts(dateStr);
  const res = await fetch(`${BASE}/${y}/${y}-${m}/`, { headers: { "User-Agent": UA } });
  if (!res.ok) throw new Error(`HTTP ${res.status} listing ${BASE}/${y}/${y}-${m}/`);
  const html = await res.text();
  const names = new Set(html.match(new RegExp(`pageviews-${compact}-\\d{6}\\.gz`, "g")) || []);
  return [...names].sort();
}

async function addHour(dateStr, name, totals) {
  const { y, m } = parts(dateStr);
  const url = `${BASE}/${y}/${y}-${m}/${name}`;
  for (let attempt = 1; ; attempt++) {
    try {
      const res = await fetch(url, { headers: { "User-Agent": UA } });
      if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
      const lines = readline.createInterface({
        input: Readable.fromWeb(res.body).pipe(zlib.createGunzip()),
        crlfDelay: Infinity,
      });
      const hour = new Map();
      for await (const line of lines) {
        // "en Some_Title 1234 0" (desktop) or "en.m Some_Title 1234 0" (mobile web)
        if (line.charCodeAt(0) !== 101 || line.charCodeAt(1) !== 110) continue; // fast "en" check
        const sp1 = line.indexOf(" ");
        const domain = line.slice(0, sp1);
        if (domain !== "en" && domain !== "en.m") continue;
        const sp2 = line.indexOf(" ", sp1 + 1);
        const sp3 = line.indexOf(" ", sp2 + 1);
        const views = parseInt(line.slice(sp2 + 1, sp3 < 0 ? undefined : sp3), 10);
        if (!(views >= 1)) continue;
        const title = line.slice(sp1 + 1, sp2);
        hour.set(title, (hour.get(title) || 0) + views);
      }
      for (const [title, views] of hour) {
        if (views >= MIN_HOURLY) totals.set(title, (totals.get(title) || 0) + views);
      }
      return;
    } catch (err) {
      if (attempt >= 3) throw err;
      await new Promise((r) => setTimeout(r, 2000 * attempt));
    }
  }
}

// Returns { articles: [{article, views, rank}], hours, files }.
// Throws if fewer than `minHours` hourly files exist yet.
async function fetchTopFromHourly(dateStr, { minHours = 18, limit = 1000, log = () => {} } = {}) {
  const files = await listHourFiles(dateStr);
  if (files.length < minHours) {
    throw new Error(`only ${files.length} of 24 hourly files for ${dateStr} so far (need ${minHours})`);
  }
  log(`  ${dateStr}: adding up ${files.length} of 24 hourly files...`);
  const totals = new Map();
  const queue = [...files];
  await Promise.all(Array.from({ length: CONCURRENCY }, async () => {
    while (queue.length) {
      const name = queue.shift();
      await addHour(dateStr, name, totals);
      log(`    ${name} done`);
    }
  }));
  const articles = [...totals]
    .filter(([title]) => title && title !== "-")
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([article, views], i) => ({ article, views, rank: i + 1 }));
  return { articles, hours: files.length, files };
}

module.exports = { fetchTopFromHourly, listHourFiles };

if (require.main === module) {
  const dateStr = process.argv[2];
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr || "")) {
    console.error("Usage: node scripts/hourly-top.js YYYY-MM-DD");
    process.exit(1);
  }
  const t0 = Date.now();
  fetchTopFromHourly(dateStr, { minHours: 1, log: (s) => console.log(s) })
    .then(({ articles, hours }) => {
      console.log(`\nTop 15 for ${dateStr} from ${hours}/24 hours (${Math.round((Date.now() - t0) / 1000)}s):`);
      for (const a of articles.slice(0, 15)) console.log(`${String(a.rank).padStart(3)}  ${a.views.toLocaleString("en-US").padStart(10)}  ${a.article}`);
    })
    .catch((err) => { console.error(err.message); process.exit(1); });
}
