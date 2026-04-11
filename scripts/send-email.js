const fs = require("fs");
const path = require("path");
const https = require("https");

const DATA_FILE = path.join(__dirname, "..", "data", "articles.json");
const API_KEY = process.env.BUTTONDOWN_API_KEY;

if (!API_KEY) {
  console.error("BUTTONDOWN_API_KEY environment variable is required");
  process.exit(1);
}

const FEATURED_FILE = path.join(__dirname, "..", "data", "featured-entries.json");
const FEATURED_INDEX_FILE = path.join(__dirname, "..", "data", "featured-index.json");
const LAST_EMAIL_FILE = path.join(__dirname, "..", "data", "last-email.txt");

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

async function fetchArticleSummary(title) {
  const url = `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title)}`;
  return httpGet(url);
}

async function getFeaturedEntry() {
  if (!fs.existsSync(FEATURED_FILE)) return null;
  const entries = JSON.parse(fs.readFileSync(FEATURED_FILE, "utf-8"));
  const state = fs.existsSync(FEATURED_INDEX_FILE)
    ? JSON.parse(fs.readFileSync(FEATURED_INDEX_FILE, "utf-8"))
    : { index: 0 };
  const idx = state.index % entries.length;
  const entry = entries[idx];
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

function formatNumber(n) {
  return n.toLocaleString("en-US");
}

function formatDateLong(dateStr) {
  const d = new Date(dateStr + "T00:00:00Z");
  return d.toLocaleDateString("en-US", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  });
}

function displayTitle(title) {
  return title.replace(/_/g, " ");
}

function formatDateShort(dateStr) {
  const d = new Date(dateStr + "T00:00:00Z");
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}

function buildEmailHtml(article, recentArticles, featured) {
  const title = displayTitle(article.title);
  const dateFormatted = formatDateLong(article.date);
  const views = formatNumber(article.views);
  const description = article.description || "";
  const extract = article.extract || "";
  const thumbnail = article.thumbnail || "";
  const url = article.url || `https://en.wikipedia.org/wiki/${encodeURIComponent(article.title)}`;

  const thumbHtml = thumbnail
    ? `<img src="${thumbnail}" alt="${title}" style="width:120px;height:120px;object-fit:cover;border-radius:8px;float:right;margin:0 0 12px 16px;" />`
    : "";

  // Build recent articles rows (last 7 days, excluding today's)
  const recentRows = recentArticles.map((a) => {
    const aTitle = displayTitle(a.title);
    const aUrl = a.url || `https://en.wikipedia.org/wiki/${encodeURIComponent(a.title)}`;
    const aDate = formatDateShort(a.date);
    const aViews = formatNumber(a.views);
    return `<tr>
      <td style="padding:6px 0;border-bottom:1px solid #f0f0f0;font-size:13px;color:#888;white-space:nowrap;vertical-align:top;">${aDate}</td>
      <td style="padding:6px 0 6px 12px;border-bottom:1px solid #f0f0f0;vertical-align:top;">
        <a href="${aUrl}" style="color:#1a1a1a;text-decoration:none;font-size:14px;">${aTitle}</a>
      </td>
      <td style="padding:6px 0 6px 12px;border-bottom:1px solid #f0f0f0;font-size:13px;color:#888;text-align:right;white-space:nowrap;vertical-align:top;">${aViews}</td>
    </tr>`;
  }).join("\n");

  return `<!-- buttondown-editor-mode: fancy -->
<div style="max-width:560px;margin:0 auto;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#1a1a1a;">

  <div style="text-align:center;padding:20px 0 12px;">
    <a href="https://wikipop.me" style="text-decoration:none;">
      <span style="font-family:Georgia,serif;font-size:22px;font-weight:700;color:#1a1a1a;">Wiki</span><span style="font-family:Georgia,serif;font-size:22px;font-weight:700;color:#c1272d;">Pop</span>
    </a>
  </div>

  <div style="border-top:1px solid #e5e5e5;padding-top:20px;">
    <p style="font-size:13px;color:#888;margin:0 0 4px;text-transform:uppercase;letter-spacing:0.5px;">
      ${dateFormatted}
    </p>

    <h1 style="font-family:Georgia,serif;font-size:26px;font-weight:700;margin:0 0 4px;line-height:1.25;">
      <a href="${url}" style="color:#1a1a1a;text-decoration:none;">${title}</a>
    </h1>

    ${description ? `<p style="font-size:14px;color:#888;margin:0 0 16px;font-style:italic;">${description}</p>` : ""}

    <div style="font-size:15px;line-height:1.6;color:#333;">
      ${thumbHtml}
      <p style="margin:0 0 16px;">${extract}</p>
    </div>

    <div style="clear:both;"></div>

    <table cellpadding="0" cellspacing="0" border="0" style="margin:16px 0;">
      <tr>
        <td style="background-color:#c1272d;border-radius:6px;padding:10px 22px;">
          <a href="${url}" style="color:#ffffff;text-decoration:none;font-size:14px;font-weight:600;">Read on Wikipedia &rarr;</a>
        </td>
      </tr>
    </table>

    <p style="font-size:13px;color:#999;margin:16px 0 0;">
      ${views} views
    </p>
  </div>

  ${featured ? `
  <div style="border-top:1px solid #e5e5e5;margin-top:24px;padding-top:16px;">
    <p style="font-size:12px;color:#888;margin:0 0 4px;text-transform:uppercase;letter-spacing:0.5px;font-weight:600;">
      Obscure Wikipedia Entry of the Day
    </p>
    <h2 style="font-family:Georgia,serif;font-size:20px;font-weight:700;margin:0 0 12px;line-height:1.25;">
      <a href="${featured.url}" style="color:#1a1a1a;text-decoration:none;">${displayTitle(featured.title)}</a>
    </h2>
    <div style="font-size:15px;line-height:1.6;color:#333;">
      ${featured.thumbnail ? `<img src="${featured.thumbnail}" alt="" style="width:100px;height:100px;object-fit:cover;border-radius:8px;float:right;margin:0 0 12px 16px;" />` : ""}
      <p style="margin:0 0 16px;">${featured.extract} <a href="${featured.url}" style="color:#c1272d;text-decoration:none;font-size:14px;font-weight:600;">Continue reading &rarr;</a></p>
    </div>
    <div style="clear:both;"></div>
  </div>
  ` : ""}

  ${recentRows ? `
  <div style="border-top:1px solid #e5e5e5;margin-top:24px;padding-top:16px;">
    <h2 style="font-family:Georgia,serif;font-size:16px;font-weight:700;margin:0 0 10px;color:#1a1a1a;">Last 7 Days</h2>
    <table cellpadding="0" cellspacing="0" border="0" style="width:100%;">
      ${recentRows}
    </table>
  </div>
  ` : ""}

  <div style="border-top:1px solid #e5e5e5;margin-top:24px;padding-top:16px;text-align:center;">
    <p style="font-size:12px;color:#aaa;margin:0;">
      <a href="https://wikipop.me" style="color:#888;text-decoration:none;">wikipop.me</a>
      &nbsp;&middot;&nbsp;
      <a href="https://wikipop.me/explore.html" style="color:#888;text-decoration:none;">Explore</a>
      &nbsp;&middot;&nbsp;
      <a href="https://wikipop.me/archive.html" style="color:#888;text-decoration:none;">Archive</a>
    </p>
  </div>

</div>`;
}

function sendEmail(subject, body) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify({
      subject,
      body,
      status: "about_to_send",
    });

    const options = {
      hostname: "api.buttondown.com",
      port: 443,
      path: "/v1/emails",
      method: "POST",
      headers: {
        Authorization: `Token ${API_KEY}`,
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(payload),
        "X-Buttondown-Live-Dangerously": "true",
      },
    };

    const req = https.request(options, (res) => {
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          console.log(`Email sent! Status: ${res.statusCode}`);
          try {
            const parsed = JSON.parse(data);
            console.log(`  ID: ${parsed.id}`);
            console.log(`  Subject: ${parsed.subject}`);
          } catch {}
          resolve(data);
        } else if (res.statusCode === 400 && data.includes("email_duplicate")) {
          console.log("Buttondown: Email is a duplicate of one already sent today. Skipping gracefully.");
          resolve(data);
        } else {
          console.error(`Failed to send email. Status: ${res.statusCode}`);
          console.error(data);
          reject(new Error(`HTTP ${res.statusCode}: ${data}`));
        }
      });
    });

    req.on("error", reject);
    req.write(payload);
    req.end();
  });
}

async function main() {
  const todayStr = new Date().toISOString().slice(0, 10);
  const articles = JSON.parse(fs.readFileSync(DATA_FILE, "utf-8"));

  // Get the latest article
  const latest = articles[articles.length - 1];
  if (!latest) {
    console.error("No articles found");
    process.exit(1);
  }

  if (fs.existsSync(LAST_EMAIL_FILE)) {
    const lastSentRaw = fs.readFileSync(LAST_EMAIL_FILE, "utf-8").trim();
    const [lastSentDate, lastSentArticleDate] = lastSentRaw.split("|");
    
    if (lastSentDate === todayStr) {
      console.log(`An email has already been sent today (${todayStr}). Skipping.`);
      return;
    }
    
    // Check if we're trying to send an article we've already sent
    // Also handling the case where lastSentRaw was just the todayStr from previous format
    if (lastSentArticleDate === latest.date || lastSentRaw === latest.date) {
      console.log(`An email for article date ${latest.date} has already been sent. Skipping.`);
      return;
    }
  }

  // Get the last 7 days (excluding today's article)
  const recentArticles = articles.slice(-8, -1).reverse();

  console.log(`Sending email for: ${displayTitle(latest.title)} (${latest.date})`);

  const featured = await getFeaturedEntry();

  const subject = featured 
    ? `WikiPop: ${displayTitle(latest.title)} + ${displayTitle(featured.title)}`
    : `WikiPop: ${displayTitle(latest.title)}`;
  const body = buildEmailHtml(latest, recentArticles, featured);

  await sendEmail(subject, body);
  fs.writeFileSync(LAST_EMAIL_FILE, todayStr + "|" + latest.date + "\n");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
