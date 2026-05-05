const fs = require("fs");
const path = require("path");
const https = require("https");

const EXPLORE_FILE = path.join(__dirname, "..", "explore.html");
const TEMPLATE_FILE = path.join(__dirname, "..", "template-explore.html");

// Keep in sync with scripts/build.js BASE_URL constant.
const BASE_URL = "https://wikipop.sowin.io";

function httpGet(url) {
  return new Promise((resolve, reject) => {
    const doRequest = (reqUrl) => {
      https.get(reqUrl, { headers: { "User-Agent": "WikiPop/1.0 (GitHub Pages; daily top article)" } }, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          doRequest(res.headers.location);
          return;
        }
        if (res.statusCode !== 200) {
          reject(new Error(`HTTP ${res.statusCode} for ${reqUrl}`));
          res.resume();
          return;
        }
        let data = "";
        res.on("data", (chunk) => (data += chunk));
        res.on("end", () => {
          try { resolve(JSON.parse(data)); }
          catch (e) { reject(e); }
        });
      }).on("error", reject);
    };
    doRequest(url);
  });
}

const SKIP_PREFIXES = [
  "Main_Page", "Special:", "Wikipedia:", "Portal:", "Help:",
  "Template:", "Category:", "File:", "Talk:", "User:",
  "MediaWiki:", "Draft:", "Module:",
];
const SKIP_EXACT = [".xxx"];

function shouldSkip(title) {
  return SKIP_PREFIXES.some((p) => title.startsWith(p)) || SKIP_EXACT.includes(title);
}

function formatNumber(n) {
  return n.toLocaleString("en-US");
}

function escapeHtml(str) {
  return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#039;");
}

function wikiUrl(title) {
  return `https://en.wikipedia.org/wiki/${encodeURIComponent(title)}`;
}

function displayTitle(title) {
  return title.replace(/_/g, " ");
}

async function fetchTop(date, project = "en.wikipedia") {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, "0");
  const d = String(date.getUTCDate()).padStart(2, "0");
  const url = `https://wikimedia.org/api/rest_v1/metrics/pageviews/top/${project}/all-access/${y}/${m}/${d}`;
  const data = await httpGet(url);
  return data.items[0].articles.filter((a) => !shouldSkip(a.article));
}

async function fetchSummary(title) {
  try {
    const url = `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title)}`;
    return await httpGet(url);
  } catch {
    return null;
  }
}

// Retry wrapper with exponential backoff. Long pause on 429 (rate limited).
// Mirrors scripts/build.js so behavior stays consistent across the two builders.
async function fetchWithRetry(fn, label, maxAttempts = 4) {
  let lastErr;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      const is429 = /HTTP 429/.test(err.message || "");
      const delay = is429 ? 60000 : 2000 * attempt;
      if (attempt < maxAttempts) {
        console.log(`  ${label}: ${err.message}, retrying in ${delay/1000}s (attempt ${attempt}/${maxAttempts})`);
        await new Promise((r) => setTimeout(r, delay));
      }
    }
  }
  throw lastErr;
}

function formatDateShort(date) {
  const months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  return `${months[date.getUTCMonth()]} ${date.getUTCDate()}`;
}

function buildRow(a, opts = {}) {
  const title = displayTitle(a.article);
  const desc = a.description || "";
  const rank = opts.showRank ? `<td class="explore-rank">#${a.rank}</td>` : "";
  const change = opts.change !== undefined
    ? `<td class="explore-change ${opts.change > 0 ? "up" : opts.change < 0 ? "down" : ""}">${opts.change > 0 ? "+" : ""}${formatNumber(opts.change)}%</td>`
    : "";
  return `<tr>
    ${rank}
    <td class="explore-title"><a href="${escapeHtml(wikiUrl(a.article))}" target="_blank" rel="noopener">${escapeHtml(title)}</a></td>
    <td class="explore-desc">${escapeHtml(desc)}</td>
    <td class="explore-views">${formatNumber(a.views)}</td>
    ${change}
  </tr>`;
}

// Countries to show in the "Around the World" section
// English-speaking countries are combined into one block since they share en.wikipedia
const COUNTRIES = [
  { name: "English Wikipedia", flags: "\u{1F1FA}\u{1F1F8}\u{1F1EC}\u{1F1E7}\u{1F1E8}\u{1F1E6}\u{1F1E6}\u{1F1FA}\u{1F1F3}\u{1F1EC}", lang: "en", project: "en.wikipedia" },
  { name: "India", flags: "\u{1F1EE}\u{1F1F3}", lang: "hi", project: "hi.wikipedia" },
  { name: "China", flags: "\u{1F1E8}\u{1F1F3}", lang: "zh", project: "zh.wikipedia" },
  { name: "France", flags: "\u{1F1EB}\u{1F1F7}", lang: "fr", project: "fr.wikipedia" },
  { name: "Indonesia", flags: "\u{1F1EE}\u{1F1E9}", lang: "id", project: "id.wikipedia" },
  { name: "Pakistan", flags: "\u{1F1F5}\u{1F1F0}", lang: "ur", project: "ur.wikipedia" },
  { name: "Brazil", flags: "\u{1F1E7}\u{1F1F7}", lang: "pt", project: "pt.wikipedia" },
  { name: "Bangladesh", flags: "\u{1F1E7}\u{1F1E9}", lang: "bn", project: "bn.wikipedia" },
  { name: "Russia", flags: "\u{1F1F7}\u{1F1FA}", lang: "ru", project: "ru.wikipedia" },
  { name: "Mexico", flags: "\u{1F1F2}\u{1F1FD}", lang: "es", project: "es.wikipedia" },
  { name: "Japan", flags: "\u{1F1EF}\u{1F1F5}", lang: "ja", project: "ja.wikipedia" },
  { name: "South Korea", flags: "\u{1F1F0}\u{1F1F7}", lang: "ko", project: "ko.wikipedia" },
  { name: "Philippines", flags: "\u{1F1F5}\u{1F1ED}", lang: "tl", project: "tl.wikipedia" },
  { name: "Egypt", flags: "\u{1F1EA}\u{1F1EC}", lang: "ar", project: "ar.wikipedia" },
  { name: "DR Congo", flags: "\u{1F1E8}\u{1F1E9}", lang: "fr", project: "fr.wikipedia" },
  { name: "Vietnam", flags: "\u{1F1FB}\u{1F1F3}", lang: "vi", project: "vi.wikipedia" },
  { name: "Iran", flags: "\u{1F1EE}\u{1F1F7}", lang: "fa", project: "fa.wikipedia" },
  { name: "Turkey", flags: "\u{1F1F9}\u{1F1F7}", lang: "tr", project: "tr.wikipedia" },
  { name: "Germany", flags: "\u{1F1E9}\u{1F1EA}", lang: "de", project: "de.wikipedia" },
  { name: "Thailand", flags: "\u{1F1F9}\u{1F1ED}", lang: "th", project: "th.wikipedia" },
];

async function fetchEnglishTitles(lang, titles) {
  // Use Wikipedia's API to get English language links for non-English articles
  if (lang === "en") return new Map(titles.map((t) => [t, null]));
  const result = new Map();
  // Fetch all at once — the API handles normalization via the "normalized" field
  const titlesParam = titles.map(encodeURIComponent).join("|");
  const url = `https://${lang}.wikipedia.org/w/api.php?action=query&titles=${titlesParam}&prop=langlinks&lllang=en&format=json`;
  try {
    const data = await httpGet(url);
    // Build reverse map from normalized title back to original title
    const normalizedToOrig = new Map();
    if (data.query.normalized) {
      for (const n of data.query.normalized) {
        normalizedToOrig.set(n.to, n.from);
      }
    }
    const pages = data.query.pages;
    for (const page of Object.values(pages)) {
      const enLink = page.langlinks && page.langlinks[0] ? page.langlinks[0]["*"] : null;
      // Map back to the original title we were given
      const origTitle = normalizedToOrig.get(page.title) || page.title;
      result.set(origTitle, enLink);
    }
  } catch {
    for (const t of titles) result.set(t, null);
  }
  return result;
}

function buildCardRow(a) {
  const title = displayTitle(a.article);
  const desc = a.description || "";
  return `<div class="explore-card">
    <div class="explore-card-rank">#${a.rank}</div>
    <div class="explore-card-body">
      <a href="${escapeHtml(wikiUrl(a.article))}" target="_blank" rel="noopener" class="explore-card-title">${escapeHtml(title)}</a>
      <span class="explore-card-desc">${escapeHtml(desc)}</span>
    </div>
    <div class="explore-card-views">${formatNumber(a.views)}</div>
  </div>`;
}

async function main() {
  const yesterday = new Date();
  yesterday.setUTCDate(yesterday.getUTCDate() - 1);
  const twoDaysAgo = new Date();
  twoDaysAgo.setUTCDate(twoDaysAgo.getUTCDate() - 2);

  console.log(`Fetching top articles for ${formatDateShort(yesterday)} and ${formatDateShort(twoDaysAgo)}...`);

  let todayArticles, prevArticles;
  try {
    [todayArticles, prevArticles] = await Promise.all([
      fetchTop(yesterday),
      fetchTop(twoDaysAgo),
    ]);
  } catch (err) {
    // Wikimedia's pageview data for "yesterday" is usually available ~4-6h after
    // UTC midnight, but the exact time isn't guaranteed. If it's not ready yet
    // (404), leave explore.html as-is — the next day's run will refresh it.
    console.log(`Could not fetch pageviews (${err.message}). Skipping explore rebuild; will retry tomorrow.`);
    return;
  }

  const prevMap = new Map(prevArticles.map((a) => [a.article, a]));

  // Enrich with descriptions (batch the ones we need)
  const allTitles = new Set();
  const enriched = new Map();

  // We'll need summaries for the deep cuts and newcomers
  const interestingArticles = [];

  // --- SECTION 1: Top 25 ---
  const top25 = todayArticles.slice(0, 25);

  // --- SECTION 2: Biggest jumps (appeared yesterday but way more views than day before) ---
  const movers = todayArticles
    .slice(0, 500)
    .filter((a) => {
      const prev = prevMap.get(a.article);
      if (!prev) return false;
      a._prevViews = prev.views;
      a._change = Math.round(((a.views - prev.views) / prev.views) * 100);
      return a._change > 50; // at least 50% increase
    })
    .sort((a, b) => b._change - a._change)
    .slice(0, 15);

  // --- SECTION 3: New arrivals (in today's top 500 but NOT in yesterday's top 1000) ---
  const newcomers = todayArticles
    .slice(0, 500)
    .filter((a) => !prevMap.has(a.article))
    .slice(0, 15);

  // --- SECTION 4: Deep cuts (rank 700-1000, the barely popular) ---
  const deepCuts = todayArticles.slice(700, 1000);
  // Pick interesting ones — filter out lists, years, and generic pages
  const interestingDeepCuts = deepCuts
    .filter((a) => {
      const t = a.article;
      return !/^\d{4}/.test(t) && !t.startsWith("List_of") && !t.startsWith("Deaths_in")
        && !t.includes("election") && !t.includes("season") && t.length > 3;
    })
    .slice(0, 20);

  // --- SECTION 5: Around the World ---
  console.log("Fetching top articles from 20 countries...");
  const countryResults = [];
  // Fetch in batches of 5 to be polite
  for (let i = 0; i < COUNTRIES.length; i += 5) {
    const batch = COUNTRIES.slice(i, i + 5);
    const results = await Promise.all(
      batch.map(async (country) => {
        try {
          const articles = await fetchWithRetry(
            () => fetchTop(yesterday, country.project),
            `${country.name} top`
          );
          const top5 = articles.slice(0, 5);
          let enMap = new Map();
          if (country.lang !== "en") {
            enMap = await fetchEnglishTitles(country.lang, top5.map((a) => a.article));
          }
          return { country, articles: top5, enMap };
        } catch (err) {
          console.log(`  ${country.name}: failed (${err.message})`);
          return { country, articles: [], enMap: new Map() };
        }
      })
    );
    countryResults.push(...results);
    if (i + 5 < COUNTRIES.length) {
      await new Promise((r) => setTimeout(r, 300));
    }
  }

  // Fetch descriptions for all interesting articles
  const needSummary = [...top25, ...movers, ...newcomers, ...interestingDeepCuts];
  const uniqueTitles = [...new Set(needSummary.map((a) => a.article))];

  console.log(`Fetching ${uniqueTitles.length} article summaries...`);
  const batchSize = 10;
  for (let i = 0; i < uniqueTitles.length; i += batchSize) {
    const batch = uniqueTitles.slice(i, i + batchSize);
    const summaries = await Promise.all(batch.map(fetchSummary));
    for (let j = 0; j < batch.length; j++) {
      if (summaries[j]) {
        enriched.set(batch[j], summaries[j]);
      }
    }
    if (i + batchSize < uniqueTitles.length) {
      await new Promise((r) => setTimeout(r, 200));
    }
  }

  // Apply descriptions
  for (const a of needSummary) {
    const s = enriched.get(a.article);
    if (s) a.description = s.description || "";
  }

  // Build HTML sections
  const top25Rows = top25.map((a) => buildRow(a, { showRank: true })).join("\n");

  const moverRows = movers.map((a) => buildRow(a, { showRank: true, change: a._change })).join("\n");

  const newcomerCards = newcomers.map(buildCardRow).join("\n");

  const deepCutCards = interestingDeepCuts.map(buildCardRow).join("\n");

  // Build country blocks
  const countryBlocks = countryResults.map(({ country, articles, enMap }) => {
    if (articles.length === 0) return "";
    const isEn = country.lang === "en";
    const langLabel = isEn ? "" : ` <span class="country-lang">${country.lang}.wikipedia</span>`;
    const items = articles.map((a, i) => {
      const title = displayTitle(a.article);
      const origUrl = `https://${country.lang}.wikipedia.org/wiki/${encodeURIComponent(a.article)}`;
      let enLink = "";
      if (!isEn) {
        const enTitle = enMap.get(a.article);
        if (enTitle) {
          const enDisplayTitle = displayTitle(enTitle);
          enLink = ` <span class="country-list-en">(<a href="${escapeHtml(wikiUrl(enTitle))}" target="_blank" rel="noopener">${escapeHtml(enDisplayTitle)}</a>)</span>`;
        }
      }
      const link = isEn
        ? `<a href="${escapeHtml(wikiUrl(a.article))}" target="_blank" rel="noopener">${escapeHtml(title)}</a>${enLink}`
        : `<a href="${escapeHtml(origUrl)}" target="_blank" rel="noopener">${escapeHtml(title)}</a>${enLink}`;
      return `<li>
        <span class="country-list-rank">${i + 1}</span>
        <span class="country-list-title">${link}</span>
        <span class="country-list-views">${formatNumber(a.views)}</span>
      </li>`;
    }).join("\n");
    return `<div class="country-block">
      <div class="country-header"><span class="country-flag">${country.flags}</span> ${escapeHtml(country.name)}${langLabel}</div>
      <ol class="country-list">${items}</ol>
    </div>`;
  }).filter(Boolean).join("\n");

  const dateStr = formatDateShort(yesterday);

  const template = fs.readFileSync(TEMPLATE_FILE, "utf-8");
  const html = template
    .replace(/\{\{BASE_URL\}\}/g, BASE_URL)
    .replace(/\{\{DATE\}\}/g, dateStr)
    .replace("{{TOP25_ROWS}}", top25Rows)
    .replace("{{MOVER_ROWS}}", moverRows)
    .replace("{{NEWCOMER_CARDS}}", newcomerCards)
    .replace("{{DEEP_CUT_CARDS}}", deepCutCards)
    .replace("{{COUNTRY_BLOCKS}}", countryBlocks)
    .replace("{{CURRENT_YEAR}}", new Date().getUTCFullYear().toString());

  fs.writeFileSync(EXPLORE_FILE, html);
  console.log("Explore page built!");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
