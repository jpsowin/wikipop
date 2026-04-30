const fs = require("fs");
const path = require("path");
const https = require("https");

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

const DATA_FILE = path.join(__dirname, "..", "data", "articles.json");
const FEATURED_FILE = path.join(__dirname, "..", "data", "featured-entries.json");
const FEATURED_INDEX_FILE = path.join(__dirname, "..", "data", "featured-index.json");
const OUTPUT_FILE = path.join(__dirname, "..", "index.html");
const ARCHIVE_FILE = path.join(__dirname, "..", "archive.html");
const FEATURED_PAGE_FILE = path.join(__dirname, "..", "featured.html");
const RSS_FILE = path.join(__dirname, "..", "feed.xml");
const TEMPLATE_FILE = path.join(__dirname, "..", "template.html");
const ARCHIVE_TEMPLATE_FILE = path.join(__dirname, "..", "template-archive.html");
const CHANGELOG_TEMPLATE_FILE = path.join(__dirname, "..", "template-changelog.html");
const CHANGELOG_FILE = path.join(__dirname, "..", "changelog.html");
const LOOKBACK_DAYS = 30;
const RECENT_LIMIT = 10; // how many to show on homepage

// Pages to skip — these are meta/special pages, not real articles
const SKIP_PREFIXES = [
  "Main_Page",
  "Special:",
  "Wikipedia:",
  "Portal:",
  "Help:",
  "Template:",
  "Category:",
  "File:",
  "Talk:",
  "User:",
  "MediaWiki:",
  "Draft:",
  "Module:",
];

// Exact titles to always skip
const SKIP_EXACT = [
  ".xxx",
];

function shouldSkip(title) {
  return SKIP_PREFIXES.some((p) => title.startsWith(p))
    || SKIP_EXACT.includes(title);
}

async function fetchTopArticles(date) {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");

  const url = `https://wikimedia.org/api/rest_v1/metrics/pageviews/top/en.wikipedia/all-access/${year}/${month}/${day}`;
  const data = await httpGet(url);
  return data.items[0].articles;
}

async function fetchArticleSummary(title) {
  const url = `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title)}`;
  return httpGet(url);
}

function loadArticles() {
  const raw = fs.readFileSync(DATA_FILE, "utf-8");
  return JSON.parse(raw);
}

function saveArticles(articles) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(articles, null, 2) + "\n");
}

function getRecentTitles(articles, days, referenceDate) {
  const cutoff = new Date(referenceDate || new Date());
  cutoff.setUTCDate(cutoff.getUTCDate() - days);
  const cutoffStr = cutoff.toISOString().slice(0, 10);

  return new Set(
    articles
      .filter((a) => a.date >= cutoffStr)
      .map((a) => a.title)
  );
}

function formatNumber(n) {
  return n.toLocaleString("en-US");
}

function formatDate(dateStr) {
  const d = new Date(dateStr + "T00:00:00Z");
  return d.toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  });
}

function formatDateShort(dateStr) {
  const d = new Date(dateStr + "T00:00:00Z");
  const month = d.toLocaleDateString("en-US", { month: "short", timeZone: "UTC" });
  const day = d.getUTCDate();
  return `${month} ${day}`;
}

function escapeHtml(str) {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function buildArchiveRow(a) {
  return `
            <tr>
              <td class="archive-date">${formatDateShort(a.date)}</td>
              <td class="archive-title"><a href="${escapeHtml(a.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(a.title.replace(/_/g, " "))}</a></td>
              <td class="archive-category">${a.description ? escapeHtml(a.description) : ""}</td>
              <td class="archive-views">${formatNumber(a.views)}</td>
            </tr>`;
}

function buildFullArchiveRow(a) {
  return `
            <tr>
              <td class="archive-date">${formatDateShort(a.date)}</td>
              <td class="archive-title"><a href="${escapeHtml(a.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(a.title.replace(/_/g, " "))}</a></td>
              <td class="archive-category">${a.description ? escapeHtml(a.description) : ""}</td>
              <td class="archive-views">${formatNumber(a.views)}</td>
            </tr>`;
}

function buildChangelogPage() {
  const template = fs.readFileSync(CHANGELOG_TEMPLATE_FILE, "utf-8");
  return template.replace(/\{\{CURRENT_YEAR\}\}/g, new Date().getUTCFullYear());
}

async function getFeaturedEntry() {
  if (!fs.existsSync(FEATURED_FILE)) return null;
  const entries = JSON.parse(fs.readFileSync(FEATURED_FILE, "utf-8"));
  const state = fs.existsSync(FEATURED_INDEX_FILE)
    ? JSON.parse(fs.readFileSync(FEATURED_INDEX_FILE, "utf-8"))
    : { index: 0 };
  const idx = state.index % entries.length;
  const entry = entries[idx];
  // Fetch extract from Wikipedia
  try {
    const wikiTitle = entry.url.replace("https://en.wikipedia.org/wiki/", "");
    const summary = await fetchArticleSummary(decodeURIComponent(wikiTitle));
    entry.extract = summary.extract || "";
    entry.thumbnail = summary.thumbnail ? summary.thumbnail.source : null;
  } catch (e) {
    entry.extract = "";
  }
  return entry;
}

function advanceFeaturedIndex() {
  if (!fs.existsSync(FEATURED_FILE)) return false;
  const entries = JSON.parse(fs.readFileSync(FEATURED_FILE, "utf-8"));
  const state = fs.existsSync(FEATURED_INDEX_FILE)
    ? JSON.parse(fs.readFileSync(FEATURED_INDEX_FILE, "utf-8"))
    : { index: 0 };
  
  const todayStr = new Date().toISOString().slice(0, 10);
  if (state.lastAdvanced !== todayStr) {
    state.index = (state.index + 1) % entries.length;
    state.lastAdvanced = todayStr;
    fs.writeFileSync(FEATURED_INDEX_FILE, JSON.stringify(state, null, 2) + "\n");
    return true;
  }
  return false;
}

function buildFeaturedPage() {
  if (!fs.existsSync(FEATURED_FILE)) return "";
  const entries = JSON.parse(fs.readFileSync(FEATURED_FILE, "utf-8"));
  const state = fs.existsSync(FEATURED_INDEX_FILE)
    ? JSON.parse(fs.readFileSync(FEATURED_INDEX_FILE, "utf-8"))
    : { index: 0 };
  const currentIdx = state.index % entries.length;

  // Show next 90 days of upcoming entries
  const today = new Date();
  const rows = [];
  for (let i = 0; i < 90; i++) {
    const d = new Date(today);
    d.setUTCDate(d.getUTCDate() + i);
    const dateStr = d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
    const entryIdx = (currentIdx + i) % entries.length;
    const entry = entries[entryIdx];
    const label = i === 0 ? " (today)" : "";
    rows.push(`<tr>
      <td style="padding:6px 12px;border-bottom:1px solid var(--border);color:var(--text-muted);font-size:0.85rem;white-space:nowrap;">${dateStr}${label}</td>
      <td style="padding:6px 12px;border-bottom:1px solid var(--border);font-size:0.85rem;color:var(--text-muted);">#${entryIdx}</td>
      <td style="padding:6px 12px;border-bottom:1px solid var(--border);"><a href="${escapeHtml(entry.url)}" target="_blank" rel="noopener" style="color:var(--text-bright);text-decoration:none;">${escapeHtml(entry.title)}</a></td>
    </tr>`);
  }

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Featured Entries — WikiPop</title>
  <meta name="robots" content="noindex, nofollow">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,400;9..144,700;9..144,800&family=Instrument+Sans:wght@400;500;600&display=swap" rel="stylesheet">
  <style>
    :root { --bg: #0f1114; --bg-raised: #181a1f; --text: #9ca3af; --text-bright: #e5e7eb; --text-muted: #6b7280; --border: #23262d; --accent: #c1272d; }
    html.light { --bg: #fafaf8; --bg-raised: #fff; --text: #4a4a4a; --text-bright: #1a1a1a; --text-muted: #888; --border: #e5e5e5; }
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: "Instrument Sans", sans-serif; background: var(--bg); color: var(--text); min-height: 100vh; }
    nav { display: flex; justify-content: space-between; align-items: center; padding: 1.5rem 2rem; }
    .logo { font-family: "Fraunces", serif; font-size: 1.25rem; font-weight: 700; color: var(--text-bright); text-decoration: none; }
    .logo span { color: var(--accent); }
    main { max-width: 700px; margin: 0 auto; padding: 0 2rem 4rem; }
    h1 { font-family: "Fraunces", serif; font-size: 1.5rem; color: var(--text-bright); margin-bottom: 0.5rem; }
    p.desc { color: var(--text-muted); font-size: 0.9rem; margin-bottom: 1.5rem; }
    table { width: 100%; border-collapse: collapse; }
    th { text-align: left; padding: 8px 12px; font-size: 0.7rem; text-transform: uppercase; letter-spacing: 0.05em; color: var(--text-muted); border-bottom: 1px solid var(--border); }
  </style>
  <!-- Google tag (gtag.js) -->
  <script async src="https://www.googletagmanager.com/gtag/js?id=G-SBPZDVN4FC"></script>
  <script>
    window.dataLayer = window.dataLayer || [];
    function gtag(){dataLayer.push(arguments);}
    gtag('js', new Date());
    gtag('config', 'G-SBPZDVN4FC');
  </script>
</head>
<body>
  <nav><a href="index.html" class="logo">Wiki<span>Pop</span></a></nav>
  <main>
    <h1>Upcoming Featured Entries</h1>
    <p class="desc">Next 90 days. Current index: ${currentIdx} of ${entries.length}.</p>
    <table>
      <thead><tr><th>Date</th><th>Index</th><th>Article</th></tr></thead>
      <tbody>${rows.join("\n")}</tbody>
    </table>
  </main>
  <script>
    (function () { const saved = localStorage.getItem("theme"); if (saved === "light") document.documentElement.classList.add("light"); })();
  </script>
</body>
</html>`;
}

async function buildHtml(articles) {
  const today = articles.length > 0 ? articles[articles.length - 1] : null;
  const archive = [...articles].reverse().slice(1);
  const recentArchive = archive.slice(0, RECENT_LIMIT);

  const template = fs.readFileSync(TEMPLATE_FILE, "utf-8");

  // Build today's article section
  let todaySection = "";
  if (today) {
    const dropCap = today.extract.charAt(0);
    const restOfExtract = today.extract.slice(1);

    todaySection = `
      <div class="hero-zone">
        <div class="comic-panel-woman">
          <img src="assets/eyes.png?v=2" alt="Comic illustration of a woman with glasses" width="768" height="1376">
        </div>
        
        <div class="article-panel">
          <div class="article-content">
            ${today.thumbnail ? `<a href="${escapeHtml(today.url)}" target="_blank" rel="noopener noreferrer" class="hero-thumb"><img src="${escapeHtml(today.thumbnail)}" alt="${escapeHtml(today.title.replace(/_/g, " "))}"></a>` : ""}
            <div class="caption-wrapper">
              <div class="comic-caption">
                <div class="caption-title">${escapeHtml(today.title.replace(/_/g, " "))}</div>
                ${today.description ? `<div class="caption-desc">${escapeHtml(today.description)}</div>` : ""}
              </div>
            </div>
            <div class="article-extract">
              <p><span class="drop-cap">${dropCap}</span>${escapeHtml(restOfExtract)}</p>
            </div>
            <div style="clear: both;"></div>
          </div>
          <div class="article-footer-strip">
            <a href="${escapeHtml(today.url)}" target="_blank" rel="noopener noreferrer" class="wiki-link">Read on Wikipedia &rarr;</a>
            <div class="strip-views">
              <span class="strip-views-number">${formatNumber(today.views)}</span>
              <span class="strip-views-label">views yesterday</span>
            </div>
          </div>
        </div>
      </div>`;
  } else {
    todaySection = `
        <div class="no-article">
          <p>No article featured yet. Check back tomorrow!</p>
        </div>`;
  }

  // Build recent archive rows
  const archiveRows = recentArchive.map(buildArchiveRow).join("");
  const moreLink = archive.length > RECENT_LIMIT
    ? `<a href="archive.html" class="archive-more">View full archive (${archive.length} articles) &rarr;</a>`
    : "";

  // Build featured entry section
  const featured = await getFeaturedEntry();
  let featuredSection = `
    <div class="fade-up">
      <div class="slanted-newsletter">
        <div class="slanted-heading">Get <span style="color: var(--red);">Wikipop'd every day</span> straight to your overflowing inbox.</div>
        <form class="slanted-form" action="https://buttondown.com/api/emails/embed-subscribe/wikipop" method="post">
          <input type="email" name="email" id="bd-email" placeholder="you@email.com" required class="slanted-input">
          <button type="submit" class="slanted-btn">Subscribe</button>
        </form>
      </div>
    </div>`;

  if (featured) {
    const thumbHtml = featured.thumbnail
      ? `<a href="${escapeHtml(featured.url)}" target="_blank" rel="noopener noreferrer"><img src="${escapeHtml(featured.thumbnail)}" alt="" class="v2-featured-img"></a>`
      : "";
    const extractText = featured.extract
      ? `<div class="v2-featured-text">${escapeHtml(featured.extract)} <a href="${escapeHtml(featured.url)}" target="_blank" rel="noopener noreferrer" class="v2-featured-readmore">Continue reading</a></div>`
      : "";
    featuredSection += `
    <div class="fade-up">
      <div class="v2-featured-box">
        <div class="v2-featured-content">
          <span class="v2-featured-label">OBSCURE WIKIPEDIA ENTRY OF THE DAY</span>
          <a href="${escapeHtml(featured.url)}" target="_blank" rel="noopener noreferrer" class="v2-featured-title">${escapeHtml(featured.title)}</a>
          ${extractText}
        </div>
        ${thumbHtml}
      </div>
    </div>`;
  }

  let html = template
    .replace("{{TODAY_SECTION}}", todaySection)
    .replace("{{FEATURED_SECTION}}", featuredSection)
    .replace("{{ARCHIVE_ROWS}}", archiveRows)
    .replace("{{ARCHIVE_MORE_LINK}}", moreLink)
    .replace("{{ARCHIVE_DISPLAY}}", recentArchive.length > 0 ? "block" : "none")
    .replace("{{CURRENT_YEAR}}", new Date().getUTCFullYear().toString());

  return html;
}

function buildArchivePage(articles) {
  const all = [...articles].reverse();
  const template = fs.readFileSync(ARCHIVE_TEMPLATE_FILE, "utf-8");

  const rows = all.map(buildFullArchiveRow).join("");

  return template
    .replace("{{ALL_ARCHIVE_ROWS}}", rows)
    .replace("{{TOTAL_ARTICLES}}", all.length.toString())
    .replace("{{CURRENT_YEAR}}", new Date().getUTCFullYear().toString());
}

function buildRss(articles) {
  const recent = [...articles].reverse().slice(0, 30);
  const now = new Date().toUTCString();

  let items = "";
  for (const a of recent) {
    const pubDate = new Date(a.date + "T06:00:00Z").toUTCString();
    items += `
    <item>
      <title>${escapeXml(a.title.replace(/_/g, " "))}</title>
      <link>${escapeXml(a.url)}</link>
      <description>${escapeXml(a.extract)}</description>
      <pubDate>${pubDate}</pubDate>
      <guid>${escapeXml(a.url)}#${a.date}</guid>
      ${a.description ? `<category>${escapeXml(a.description)}</category>` : ""}
    </item>`;
  }

  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>WikiPop</title>
    <description>The most popular Wikipedia article, every day.</description>
    <link>https://jpsowin.github.io/wikipop/</link>
    <atom:link href="https://jpsowin.github.io/wikipop/feed.xml" rel="self" type="application/rss+xml"/>
    <lastBuildDate>${now}</lastBuildDate>
    <language>en-us</language>${items}
  </channel>
</rss>
`;
}

function escapeXml(str) {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

async function processDate(date, articles) {
  const dateStr = date.toISOString().slice(0, 10);

  // Check if we already have an entry for this date
  if (articles.some((a) => a.date === dateStr)) {
    console.log(`  ${dateStr}: already have an article, skipping.`);
    return false;
  }

  let topArticles;
  try {
    topArticles = await fetchTopArticles(date);
  } catch (err) {
    console.log(`  ${dateStr}: API error (${err.message}), skipping.`);
    return false;
  }

  const recentTitles = getRecentTitles(articles, LOOKBACK_DAYS, date);

  // Find the first qualifying article
  let chosen = null;
  let summary = null;
  for (const entry of topArticles) {
    if (shouldSkip(entry.article)) continue;
    if (recentTitles.has(entry.article)) continue;
    
    try {
      summary = await fetchArticleSummary(entry.article);
      chosen = entry;
      break;
    } catch (err) {
      console.log(`  Skipping ${entry.article} due to summary fetch error: ${err.message}`);
    }
  }

  if (!chosen) {
    console.log(`  ${dateStr}: no qualifying article found.`);
    return false;
  }

  const newEntry = {
    date: dateStr,
    title: chosen.article,
    views: chosen.views,
    rank: chosen.rank,
    type: summary.type || "standard",
    extract: summary.extract || "",
    description: summary.description || "",
    thumbnail: summary.thumbnail ? summary.thumbnail.source : null,
    url: summary.content_urls ? summary.content_urls.desktop.page : `https://en.wikipedia.org/wiki/${chosen.article}`,
  };

  articles.push(newEntry);
  console.log(`  ${dateStr}: "${chosen.article}" — ${formatNumber(chosen.views)} views`);
  return true;
}

async function main() {
  const backfillDays = process.argv.includes("--backfill")
    ? parseInt(process.argv[process.argv.indexOf("--backfill") + 1] || "30", 10)
    : 1;

  const articles = loadArticles();
  let changed = false;

  for (let i = backfillDays; i >= 1; i--) {
    const date = new Date();
    date.setUTCDate(date.getUTCDate() - i);
    console.log(`Fetching ${date.toISOString().slice(0, 10)}...`);

    const added = await processDate(date, articles);
    if (added) changed = true;

    // Small delay between API calls to be polite
    if (i > 1) await new Promise((r) => setTimeout(r, 500));
  }

  // Sort by date
  articles.sort((a, b) => a.date.localeCompare(b.date));

  if (changed) {
    saveArticles(articles);
    if (advanceFeaturedIndex()) {
      console.log("Advanced featured entry index.");
    }
  }

  console.log("Building HTML...");
  fs.writeFileSync(OUTPUT_FILE, await buildHtml(articles));
  fs.writeFileSync(ARCHIVE_FILE, buildArchivePage(articles));
  fs.writeFileSync(CHANGELOG_FILE, buildChangelogPage());
  fs.writeFileSync(RSS_FILE, buildRss(articles));
  fs.writeFileSync(FEATURED_PAGE_FILE, buildFeaturedPage());
  console.log(`Done! ${articles.length} total articles.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
