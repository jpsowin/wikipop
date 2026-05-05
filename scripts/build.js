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
const DAY_DIR = path.join(__dirname, "..", "day");
const DAY_TEMPLATE_FILE = path.join(__dirname, "..", "template-day.html");
const SITEMAP_FILE = path.join(__dirname, "..", "sitemap.xml");
const LLMS_FULL_FILE = path.join(__dirname, "..", "llms-full.txt");
const LOOKBACK_DAYS = 30;
const RECENT_LIMIT = 10; // how many to show on homepage
const TOP_N = 10; // how many top articles to capture per day for per-day pages

// Site base URL — used only for absolute fields where the spec requires it
// (canonical, OG, sitemap, JSON-LD). Internal links stay relative.
// CHANGE THIS LINE when migrating to a new domain.
const BASE_URL = "https://wikipop.sowin.io";

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

// JSON-LD safety: prevent any embedded "</script" from breaking out of the script tag.
function escapeJsonLd(str) {
  return str.replace(/<\/script/gi, "<\\/script");
}

function jsonLd(obj) {
  return `<script type="application/ld+json">\n${escapeJsonLd(JSON.stringify(obj, null, 2))}\n</script>`;
}

// Slugify a Wikipedia title for use in URLs.
// Strips accents, lowercases, replaces underscores/non-alnum with hyphens, caps at 60 chars.
function slugify(title) {
  return title
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/_/g, "-").toLowerCase()
    .replace(/[^a-z0-9-]/g, "")
    .replace(/-+/g, "-").replace(/^-|-$/g, "")
    .slice(0, 60);
}

// Day directory name used in URLs: e.g. "2026-04-30-aubrey-plaza"
function dayDirName(article) {
  const slug = slugify(article.title);
  return slug ? `${article.date}-${slug}` : article.date;
}

function dayUrlPath(article) {
  return `day/${dayDirName(article)}/`;
}

function dayAbsoluteUrl(article) {
  return `${BASE_URL}/${dayUrlPath(article)}`;
}

// Homepage recent-archive row: keep title linking to Wikipedia (preserves
// landing-page click behavior), append a small ".day" link to the on-site
// per-day page so crawlers can find them from the homepage.
function buildArchiveRow(a) {
  const dayHref = dayUrlPath(a);
  return `
            <tr>
              <td class="archive-date">${formatDateShort(a.date)}</td>
              <td class="archive-title"><a href="${escapeHtml(a.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(a.title.replace(/_/g, " "))}</a> <a href="${dayHref}" class="archive-day-link" aria-label="View top 10 for ${formatDate(a.date)}">·day</a></td>
              <td class="archive-category">${a.description ? escapeHtml(a.description) : ""}</td>
              <td class="archive-views">${formatNumber(a.views)}</td>
            </tr>`;
}

// Archive megapage row: title links to the internal per-day page (richer
// content). Adds a small "(Wikipedia)" secondary link for users who want
// to skip straight to Wikipedia.
function buildFullArchiveRow(a) {
  const dayHref = dayUrlPath(a);
  return `
            <tr>
              <td class="archive-date">${formatDateShort(a.date)}</td>
              <td class="archive-title"><a href="${dayHref}">${escapeHtml(a.title.replace(/_/g, " "))}</a><a href="${escapeHtml(a.url)}" target="_blank" rel="noopener noreferrer" class="archive-wiki-link" aria-label="Read on Wikipedia">↗</a></td>
              <td class="archive-category">${a.description ? escapeHtml(a.description) : ""}</td>
              <td class="archive-views">${formatNumber(a.views)}</td>
            </tr>`;
}

function buildChangelogPage() {
  const template = fs.readFileSync(CHANGELOG_TEMPLATE_FILE, "utf-8");
  return template
    .replace(/\{\{BASE_URL\}\}/g, BASE_URL)
    .replace(/\{\{CURRENT_YEAR\}\}/g, new Date().getUTCFullYear());
}

async function getFeaturedEntry() {
  if (!fs.existsSync(FEATURED_FILE)) return null;
  const entries = JSON.parse(fs.readFileSync(FEATURED_FILE, "utf-8"));
  const state = fs.existsSync(FEATURED_INDEX_FILE)
    ? JSON.parse(fs.readFileSync(FEATURED_INDEX_FILE, "utf-8"))
    : { index: 0 };
  const idx = state.index % entries.length;
  const entry = entries[idx];
  // Use cached extract/thumbnail if present (populated by ensureObscureSummaries),
  // otherwise fetch fresh from Wikipedia.
  if (entry.extract === undefined) {
    try {
      const wikiTitle = entry.url.replace("https://en.wikipedia.org/wiki/", "");
      const summary = await fetchArticleSummary(decodeURIComponent(wikiTitle));
      entry.extract = summary.extract || "";
      entry.thumbnail = summary.thumbnail ? summary.thumbnail.source : null;
    } catch (e) {
      entry.extract = "";
    }
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
  let todayJsonLd = "";
  if (today) {
    const dropCap = today.extract.charAt(0);
    const restOfExtract = today.extract.slice(1);
    const displayTitle = today.title.replace(/_/g, " ");

    todayJsonLd = jsonLd({
      "@context": "https://schema.org",
      "@type": "NewsArticle",
      "headline": `${displayTitle} — Top Wikipedia Article on ${formatDate(today.date)}`,
      "datePublished": today.date,
      "dateModified": today.date,
      "image": today.thumbnail ? [today.thumbnail] : undefined,
      "description": today.description || today.extract.slice(0, 200),
      "url": `${BASE_URL}/`,
      "mainEntityOfPage": `${BASE_URL}/`,
      "publisher": { "@type": "Organization", "name": "WikiPop", "url": `${BASE_URL}/` },
      "about": { "@type": "Thing", "name": displayTitle, "sameAs": today.url },
      "interactionStatistic": {
        "@type": "InteractionCounter",
        "interactionType": "https://schema.org/ReadAction",
        "userInteractionCount": today.views
      }
    });

    todaySection = `
      <div class="hero-zone">
        <div class="comic-panel-woman">
          <img src="assets/eyes.png?v=2" alt="Comic illustration of a woman with glasses" width="768" height="1376">
        </div>

        <div class="article-panel">
          <div class="article-content">
            ${today.thumbnail ? `<a href="${escapeHtml(today.url)}" target="_blank" rel="noopener noreferrer" class="hero-thumb"><img src="${escapeHtml(today.thumbnail)}" alt="${escapeHtml(displayTitle)}"></a>` : ""}
            <div class="caption-wrapper">
              <div class="comic-caption">
                <h2 class="caption-title">${escapeHtml(displayTitle)}</h2>
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
          <h2>Today's article isn't ready yet</h2>
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
    .replace("{{TODAY_JSONLD}}", todayJsonLd)
    .replace(/\{\{BASE_URL\}\}/g, BASE_URL)
    .replace("{{CURRENT_YEAR}}", new Date().getUTCFullYear().toString());

  return html;
}

function buildArchivePage(articles) {
  const all = [...articles].reverse();
  const template = fs.readFileSync(ARCHIVE_TEMPLATE_FILE, "utf-8");

  // Group rows by month with sticky headers
  const monthLabel = (dateStr) => {
    const d = new Date(dateStr + "T00:00:00Z");
    return d.toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
  };
  const rowParts = [];
  let currentMonth = "";
  for (const a of all) {
    const m = monthLabel(a.date);
    if (m !== currentMonth) {
      rowParts.push(`\n            <tr class="month-header"><td colspan="4">${escapeHtml(m)}</td></tr>`);
      currentMonth = m;
    }
    rowParts.push(buildFullArchiveRow(a));
  }
  const rows = rowParts.join("");

  // ItemList JSON-LD for the most recent 30 articles (cap to keep page size sensible)
  const recentForLd = all.slice(0, 30);
  const archiveJsonLd = jsonLd({
    "@context": "https://schema.org",
    "@type": "ItemList",
    "name": "WikiPop Archive — recent days",
    "url": `${BASE_URL}/archive.html`,
    "numberOfItems": recentForLd.length,
    "itemListElement": recentForLd.map((a) => ({
      "@type": "ListItem",
      "url": dayAbsoluteUrl(a),
      "name": `${a.title.replace(/_/g, " ")} — ${formatDate(a.date)}`
    }))
  });

  return template
    .replace("{{ALL_ARCHIVE_ROWS}}", rows)
    .replace("{{TOTAL_ARTICLES}}", all.length.toString())
    .replace("{{ARCHIVE_JSONLD}}", archiveJsonLd)
    .replace(/\{\{BASE_URL\}\}/g, BASE_URL)
    .replace("{{CURRENT_YEAR}}", new Date().getUTCFullYear().toString());
}

// =====================================================================
// Per-day page
// =====================================================================

function buildDayPage(article, prevArticle, nextArticle, obscureEntry) {
  const template = fs.readFileSync(DAY_TEMPLATE_FILE, "utf-8");
  const displayTitle = article.title.replace(/_/g, " ");
  const formattedDate = formatDate(article.date);
  // Shorter form for the speech bubble to fit comfortably (e.g. "Apr 27, 2026")
  const d = new Date(article.date + "T00:00:00Z");
  const speechDate = `${d.toLocaleDateString("en-US", { month: "short", timeZone: "UTC" })} ${d.getUTCDate()}, ${d.getUTCFullYear()}`;
  const dropCap = (article.extract || "X").charAt(0);
  const restOfExtract = (article.extract || "").slice(1);

  const ogImage = article.thumbnail || `${BASE_URL}/assets/og-default.png`;
  const canonicalUrl = dayAbsoluteUrl(article);

  // Description: top 3 article names + view counts, makes a useful SERP snippet.
  const top10 = article.top10 || [];
  const descBits = top10.slice(0, 3).map((t) => {
    const name = t.title.replace(/_/g, " ");
    return `${name} (${formatViewsShort(t.views)} views)`;
  });
  const metaDescription = top10.length > 0
    ? `The ${top10.length} most-viewed Wikipedia articles on ${formattedDate}: ${descBits.join(", ")}, and more.`
    : `${displayTitle} was the top Wikipedia article on ${formattedDate} with ${formatNumber(article.views)} views.`;

  // Hero article markup (mirrors homepage style)
  const heroSection = `
      <div class="hero-zone">
        <div class="article-panel">
          <div class="article-content">
            ${article.thumbnail ? `<a href="${escapeHtml(article.url)}" target="_blank" rel="noopener noreferrer" class="hero-thumb"><img src="${escapeHtml(article.thumbnail)}" alt="${escapeHtml(displayTitle)}"></a>` : ""}
            <div class="day-hero-label">WikiPop's Pick · ${escapeHtml(formattedDate)}</div>
            <h2 class="day-hero-title">${escapeHtml(displayTitle)}</h2>
            ${article.description ? `<div class="day-hero-desc">${escapeHtml(article.description)}</div>` : ""}
            <div class="article-extract">
              <p><span class="drop-cap">${escapeHtml(dropCap)}</span>${escapeHtml(restOfExtract)}</p>
            </div>
            <div style="clear: both;"></div>
          </div>
          <div class="article-footer-strip">
            <a href="${escapeHtml(article.url)}" target="_blank" rel="noopener noreferrer" class="wiki-link">Read on Wikipedia &rarr;</a>
            <div class="strip-views">
              <span class="strip-views-number">${formatNumber(article.views)}</span>
              <span class="strip-views-label">views that day</span>
            </div>
          </div>
        </div>
      </div>`;

  // Top-10 list
  let top10Section = "";
  if (top10.length > 0) {
    const items = top10.map((t) => {
      const name = t.title.replace(/_/g, " ");
      const isPick = t.title === article.title;
      return `
        <li class="top10-item${isPick ? " top10-pick" : ""}">
          <span class="top10-rank">#${t.rank}</span>
          <div class="top10-body">
            <a href="${escapeHtml(t.url)}" target="_blank" rel="noopener noreferrer" class="top10-title">${escapeHtml(name)}</a>${isPick ? ` <span class="top10-pick-tag">WikiPop's pick</span>` : ""}
            ${t.description ? `<div class="top10-desc">${escapeHtml(t.description)}</div>` : ""}
          </div>
          <span class="top10-views">${formatNumber(t.views)}</span>
        </li>`;
    }).join("");
    top10Section = `
      <section class="top10-section">
        <h2>The full top 10 of ${escapeHtml(formattedDate)}</h2>
        <p class="top10-subtitle">The most-viewed Wikipedia articles that day, by raw page views.</p>
        <ol class="top10-list">${items}</ol>
      </section>`;
  }

  // Obscure entry of the day — mirrors the homepage's rich box.
  // Extract/thumbnail come from the cache built up in featured-entries.json.
  let obscureSection = "";
  if (obscureEntry) {
    const thumbHtml = obscureEntry.thumbnail
      ? `<a href="${escapeHtml(obscureEntry.url)}" target="_blank" rel="noopener noreferrer"><img src="${escapeHtml(obscureEntry.thumbnail)}" alt="" class="v2-featured-img"></a>`
      : "";
    const extractText = obscureEntry.extract
      ? `<div class="v2-featured-text">${escapeHtml(obscureEntry.extract)} <a href="${escapeHtml(obscureEntry.url)}" target="_blank" rel="noopener noreferrer" class="v2-featured-readmore">Continue reading</a></div>`
      : "";
    obscureSection = `
      <div class="v2-featured-box">
        <div class="v2-featured-content">
          <span class="v2-featured-label">OBSCURE WIKIPEDIA ENTRY OF THE DAY</span>
          <a href="${escapeHtml(obscureEntry.url)}" target="_blank" rel="noopener noreferrer" class="v2-featured-title">${escapeHtml(obscureEntry.title)}</a>
          ${extractText}
        </div>
        ${thumbHtml}
      </div>`;
  }

  // Prev/next nav
  const prevLink = prevArticle
    ? `<a href="../${dayDirName(prevArticle)}/" class="day-nav-prev" rel="prev">← ${escapeHtml(formatDateShort(prevArticle.date))}: ${escapeHtml(prevArticle.title.replace(/_/g, " "))}</a>`
    : `<span class="day-nav-prev day-nav-disabled"></span>`;
  const nextLink = nextArticle
    ? `<a href="../${dayDirName(nextArticle)}/" class="day-nav-next" rel="next">${escapeHtml(formatDateShort(nextArticle.date))}: ${escapeHtml(nextArticle.title.replace(/_/g, " "))} →</a>`
    : `<span class="day-nav-next day-nav-disabled"></span>`;

  // JSON-LD: NewsArticle for the page + ItemList for top 10
  const newsArticleLd = jsonLd({
    "@context": "https://schema.org",
    "@type": "NewsArticle",
    "headline": `Top Wikipedia articles on ${formattedDate}`,
    "datePublished": article.date,
    "dateModified": article.date,
    "image": article.thumbnail ? [article.thumbnail] : undefined,
    "description": metaDescription,
    "url": canonicalUrl,
    "mainEntityOfPage": canonicalUrl,
    "publisher": { "@type": "Organization", "name": "WikiPop", "url": `${BASE_URL}/` },
    "about": { "@type": "Thing", "name": displayTitle, "sameAs": article.url },
    "interactionStatistic": {
      "@type": "InteractionCounter",
      "interactionType": "https://schema.org/ReadAction",
      "userInteractionCount": article.views
    }
  });
  const itemListLd = top10.length > 0 ? jsonLd({
    "@context": "https://schema.org",
    "@type": "ItemList",
    "name": `Top ${top10.length} Wikipedia articles on ${formattedDate}`,
    "url": canonicalUrl,
    "numberOfItems": top10.length,
    "itemListElement": top10.map((t) => ({
      "@type": "ListItem",
      "url": t.url,
      "name": t.title.replace(/_/g, " ")
    }))
  }) : "";
  const dayJsonLd = `${newsArticleLd}\n${itemListLd}`;

  return template
    .replace(/\{\{BASE_URL\}\}/g, BASE_URL)
    .replace(/\{\{CANONICAL_URL\}\}/g, canonicalUrl)
    .replace(/\{\{PAGE_TITLE\}\}/g, `Top Wikipedia articles on ${formattedDate} — WikiPop`)
    .replace(/\{\{META_DESCRIPTION\}\}/g, metaDescription.replace(/"/g, "&quot;"))
    .replace(/\{\{OG_IMAGE\}\}/g, ogImage)
    .replace(/\{\{DATE_FORMATTED\}\}/g, escapeHtml(speechDate))
    .replace(/\{\{HERO_SECTION\}\}/g, heroSection)
    .replace(/\{\{TOP10_SECTION\}\}/g, top10Section)
    .replace(/\{\{OBSCURE_SECTION\}\}/g, obscureSection)
    .replace(/\{\{PREV_LINK\}\}/g, prevLink)
    .replace(/\{\{NEXT_LINK\}\}/g, nextLink)
    .replace(/\{\{DAY_JSONLD\}\}/g, dayJsonLd)
    .replace(/\{\{CURRENT_YEAR\}\}/g, new Date().getUTCFullYear().toString());
}

function formatViewsShort(n) {
  if (n >= 1000000) return (n / 1000000).toFixed(1).replace(/\.0$/, "") + "M";
  if (n >= 1000) return Math.round(n / 1000) + "K";
  return String(n);
}

// Deterministic mapping of date → obscure-entry index. Anchored to today's
// current featured-index value, then projected backward by epoch-days delta.
// Stable across rebuilds: each calendar date always gets the same entry,
// regardless of when the build runs.
function epochDays(dateStr) {
  return Math.floor(new Date(dateStr + "T00:00:00Z").getTime() / 86400000);
}
function getObscureForDate(dateStr, anchorDate, anchorIndex, entries) {
  if (!entries || entries.length === 0) return null;
  const N = entries.length;
  const offset = ((anchorIndex - epochDays(anchorDate)) % N + N) % N;
  const idx = ((epochDays(dateStr) + offset) % N + N) % N;
  return entries[idx];
}

// Fetch + cache extract/description/thumbnail for any obscure entries
// referenced by per-day pages that don't already have them. Saves to
// featured-entries.json so subsequent builds don't refetch.
async function ensureObscureSummaries(articles) {
  if (!fs.existsSync(FEATURED_FILE) || !fs.existsSync(FEATURED_INDEX_FILE)) return;
  const entries = JSON.parse(fs.readFileSync(FEATURED_FILE, "utf-8"));
  const state = JSON.parse(fs.readFileSync(FEATURED_INDEX_FILE, "utf-8"));
  const anchorDate = state.lastAdvanced || new Date().toISOString().slice(0, 10);
  const anchorIndex = state.index || 0;

  // Determine which entry indices are referenced by any per-day page
  const neededIdx = new Set();
  const N = entries.length;
  const offset = ((anchorIndex - epochDays(anchorDate)) % N + N) % N;
  for (const a of articles) {
    const idx = ((epochDays(a.date) + offset) % N + N) % N;
    if (!entries[idx].extract) neededIdx.add(idx);
  }
  if (neededIdx.size === 0) return;

  console.log(`Fetching ${neededIdx.size} obscure entry summaries (cached to featured-entries.json)...`);
  let fetched = 0, failed = 0, processed = 0;
  for (const idx of neededIdx) {
    const e = entries[idx];
    const wikiTitle = decodeURIComponent(e.url.replace("https://en.wikipedia.org/wiki/", ""));
    let summary = null;
    let lastErr = null;
    // Retry up to 4 times with backoff. Long backoff on 429 (rate limit).
    for (let attempt = 1; attempt <= 4; attempt++) {
      try {
        summary = await fetchArticleSummary(wikiTitle);
        break;
      } catch (err) {
        lastErr = err;
        const is429 = /HTTP 429/.test(err.message || "");
        await new Promise((r) => setTimeout(r, is429 ? 30000 : 1000 * attempt));
      }
    }
    if (summary) {
      e.extract = summary.extract || "";
      e.description = summary.description || "";
      e.thumbnail = summary.thumbnail ? summary.thumbnail.source : null;
      fetched++;
    } else {
      // Don't write `extract: ""` so future runs retry
      console.log(`  failed: ${e.title} (${lastErr?.message || "unknown"})`);
      failed++;
    }
    processed++;
    if (processed % 25 === 0) {
      console.log(`  ...processed ${processed}/${neededIdx.size} (${fetched} ok, ${failed} failed)`);
      fs.writeFileSync(FEATURED_FILE, JSON.stringify(entries, null, 2) + "\n");
    }
    await new Promise((r) => setTimeout(r, 700));
  }
  fs.writeFileSync(FEATURED_FILE, JSON.stringify(entries, null, 2) + "\n");
  console.log(`Done. Cached ${fetched} new obscure entry summaries (${failed} failed).`);
}

function buildDayPages(articles) {
  if (!fs.existsSync(DAY_TEMPLATE_FILE)) {
    console.log("No template-day.html found; skipping per-day page generation.");
    return 0;
  }
  if (!fs.existsSync(DAY_DIR)) fs.mkdirSync(DAY_DIR, { recursive: true });

  // Load featured entries and compute the date→entry anchor once
  let featuredEntries = [];
  let anchorDate = new Date().toISOString().slice(0, 10);
  let anchorIndex = 0;
  if (fs.existsSync(FEATURED_FILE)) {
    featuredEntries = JSON.parse(fs.readFileSync(FEATURED_FILE, "utf-8"));
  }
  if (fs.existsSync(FEATURED_INDEX_FILE)) {
    const state = JSON.parse(fs.readFileSync(FEATURED_INDEX_FILE, "utf-8"));
    anchorIndex = state.index || 0;
    if (state.lastAdvanced) anchorDate = state.lastAdvanced;
  }

  // Sort ascending so prev/next nav is by chronological order
  const sorted = [...articles].sort((a, b) => a.date.localeCompare(b.date));
  let written = 0;
  for (let i = 0; i < sorted.length; i++) {
    const a = sorted[i];
    const prev = i > 0 ? sorted[i - 1] : null;
    const next = i < sorted.length - 1 ? sorted[i + 1] : null;
    const obscure = getObscureForDate(a.date, anchorDate, anchorIndex, featuredEntries);
    const dir = path.join(DAY_DIR, dayDirName(a));
    const file = path.join(dir, "index.html");
    const html = buildDayPage(a, prev, next, obscure);
    // Only write if changed (keeps git diffs small)
    if (fs.existsSync(file)) {
      const existing = fs.readFileSync(file, "utf-8");
      if (existing === html) continue;
    } else {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(file, html);
    written++;
  }
  return written;
}

// =====================================================================
// Sitemap
// =====================================================================

function buildSitemap(articles) {
  const today = new Date().toISOString().slice(0, 10);
  const urls = [];
  const u = (loc, lastmod, changefreq, priority) =>
    urls.push(`  <url>\n    <loc>${loc}</loc>\n    <lastmod>${lastmod}</lastmod>\n    <changefreq>${changefreq}</changefreq>\n    <priority>${priority}</priority>\n  </url>`);

  u(`${BASE_URL}/`, today, "daily", "1.0");
  u(`${BASE_URL}/archive.html`, today, "daily", "0.8");
  u(`${BASE_URL}/explore.html`, today, "daily", "0.6");
  u(`${BASE_URL}/changelog.html`, today, "monthly", "0.3");

  // Per-day URLs (only those that produced a page)
  const sorted = [...articles].sort((a, b) => a.date.localeCompare(b.date));
  for (const a of sorted) {
    const file = path.join(DAY_DIR, dayDirName(a), "index.html");
    if (!fs.existsSync(file)) continue;
    u(dayAbsoluteUrl(a), a.date, "monthly", "0.7");
  }

  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join("\n")}\n</urlset>\n`;
}

// =====================================================================
// llms-full.txt
// =====================================================================

function buildLlmsFullTxt(articles) {
  const sorted = [...articles].sort((a, b) => b.date.localeCompare(a.date));
  const lines = [];
  lines.push("# WikiPop — every day's top Wikipedia article and full top 10");
  lines.push("");
  lines.push(`Source: ${BASE_URL}/ (canonical URL)`);
  lines.push("Updated daily. Each section is one day. WikiPop's Pick is the curated entry; the rest of the top 10 is the raw Wikimedia data filtered for non-article pages.");
  lines.push("");
  lines.push("---");
  lines.push("");

  for (const a of sorted) {
    const displayTitle = a.title.replace(/_/g, " ");
    lines.push(`## ${a.date} — WikiPop's Pick: ${displayTitle}`);
    lines.push("");
    if (a.description) lines.push(`Category: ${a.description}`);
    lines.push(`Views: ${formatNumber(a.views)}`);
    lines.push(`Wikipedia: ${a.url}`);
    lines.push(`On-site page: ${dayAbsoluteUrl(a)}`);
    lines.push("");
    if (a.extract) lines.push(a.extract);
    lines.push("");
    if (a.top10 && a.top10.length > 0) {
      lines.push(`### Full top 10 on ${a.date}`);
      for (const t of a.top10) {
        const name = t.title.replace(/_/g, " ");
        const desc = t.description ? `: ${t.description}` : "";
        lines.push(`- ${name} (${formatNumber(t.views)} views)${desc}`);
      }
      lines.push("");
    }
    lines.push("---");
    lines.push("");
  }
  return lines.join("\n");
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
    <link>${BASE_URL}/</link>
    <atom:link href="${BASE_URL}/feed.xml" rel="self" type="application/rss+xml"/>
    <docs>https://www.rssboard.org/rss-specification</docs>
    <image>
      <url>${BASE_URL}/assets/og-default.png</url>
      <title>WikiPop</title>
      <link>${BASE_URL}/</link>
    </image>
    <copyright>Public archive of Wikipedia pageview data. Article content from Wikipedia under CC BY-SA.</copyright>
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
    topArticles = await fetchWithRetry(() => fetchTopArticles(date), `${dateStr} top`);
  } catch (err) {
    console.log(`  ${dateStr}: API error after retries (${err.message}), skipping.`);
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

  // Also capture the day's REAL top 10 (skip-filter only, no 30-day dedup).
  // The dedup is for "what's the WikiPop pick"; per-day pages should reflect
  // what was actually most-viewed.
  const top10 = await fetchTop10Summaries(topArticles);

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
    top10,
  };

  articles.push(newEntry);
  console.log(`  ${dateStr}: "${chosen.article}" — ${formatNumber(chosen.views)} views (+ ${top10.length} in top10)`);
  return true;
}

// Given an array of top-N raw Wikimedia articles, filter via shouldSkip,
// take the first TOP_N, and fetch description-only summaries for each.
async function fetchTop10Summaries(topArticles) {
  const filtered = topArticles.filter((e) => !shouldSkip(e.article)).slice(0, TOP_N);
  const out = [];
  for (const entry of filtered) {
    let description = "";
    let url = `https://en.wikipedia.org/wiki/${encodeURIComponent(entry.article)}`;
    try {
      const s = await fetchWithRetry(() => fetchArticleSummary(entry.article), `summary ${entry.article}`, 3);
      description = s.description || "";
      if (s.content_urls && s.content_urls.desktop && s.content_urls.desktop.page) {
        url = s.content_urls.desktop.page;
      }
    } catch (err) {
      // Leave description empty if summary fetch fails after retries.
    }
    out.push({
      rank: entry.rank,
      title: entry.article,
      views: entry.views,
      description,
      url,
    });
    // Be polite to the Wikimedia API
    await new Promise((r) => setTimeout(r, 400));
  }
  return out;
}

// Retry wrapper with exponential backoff. Long pause on 429 (rate limited).
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

// Backfill: for entries missing top10, re-fetch and populate.
// Saves periodically so progress isn't lost on interruption.
async function rebuildTop10(articles) {
  console.log("Backfilling top10 for entries that don't have it...");
  let count = 0, processed = 0;
  for (const a of articles) {
    if (a.top10 && a.top10.length > 0) continue;
    const date = new Date(a.date + "T00:00:00Z");
    let topArticles;
    try {
      topArticles = await fetchWithRetry(() => fetchTopArticles(date), a.date + " top");
    } catch (err) {
      console.log(`  ${a.date}: skipped after retries (${err.message})`);
      continue;
    }
    a.top10 = await fetchTop10Summaries(topArticles);
    count++;
    processed++;
    console.log(`  ${a.date}: filled top10 (${a.top10.length} entries)`);
    if (processed % 20 === 0) {
      saveArticles(articles);
      console.log(`  --- saved progress (${count} done) ---`);
    }
    await new Promise((r) => setTimeout(r, 1500));
  }
  saveArticles(articles);
  console.log(`Backfilled ${count} entries.`);
}

async function main() {
  const articles = loadArticles();
  let changed = false;

  // One-shot backfill: fill top10 for any historical entries that don't have it.
  if (process.argv.includes("--rebuild-top10")) {
    await rebuildTop10(articles);
    saveArticles(articles);
    changed = true;
  }

  const backfillDays = process.argv.includes("--backfill")
    ? parseInt(process.argv[process.argv.indexOf("--backfill") + 1] || "30", 10)
    : 1;

  // Skip the daily fetch in pure --rebuild-top10 mode if no other flags given
  const skipDaily = process.argv.includes("--no-daily");

  if (!skipDaily) {
    for (let i = backfillDays; i >= 1; i--) {
      const date = new Date();
      date.setUTCDate(date.getUTCDate() - i);
      console.log(`Fetching ${date.toISOString().slice(0, 10)}...`);

      const added = await processDate(date, articles);
      if (added) changed = true;

      // Small delay between API calls to be polite
      if (i > 1) await new Promise((r) => setTimeout(r, 500));
    }
  }

  // Sort by date
  articles.sort((a, b) => a.date.localeCompare(b.date));

  if (changed) {
    saveArticles(articles);
    if (!skipDaily && advanceFeaturedIndex()) {
      console.log("Advanced featured entry index.");
    }
  }

  console.log("Building HTML...");
  fs.writeFileSync(OUTPUT_FILE, await buildHtml(articles));
  fs.writeFileSync(ARCHIVE_FILE, buildArchivePage(articles));
  fs.writeFileSync(CHANGELOG_FILE, buildChangelogPage());
  fs.writeFileSync(RSS_FILE, buildRss(articles));
  fs.writeFileSync(FEATURED_PAGE_FILE, buildFeaturedPage());

  await ensureObscureSummaries(articles);

  const dayCount = buildDayPages(articles);
  console.log(`Wrote/updated ${dayCount} per-day pages.`);

  fs.writeFileSync(SITEMAP_FILE, buildSitemap(articles));
  fs.writeFileSync(LLMS_FULL_FILE, buildLlmsFullTxt(articles));
  console.log("Wrote sitemap.xml and llms-full.txt.");

  console.log(`Done! ${articles.length} total articles.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
