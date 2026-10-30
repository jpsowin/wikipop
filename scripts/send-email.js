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
const { dayAbsoluteUrl } = require("./build");

// Each subscriber's personal signup link. Buttondown fills in the code per
// recipient (Settings → General → Referrals must be on to credit referrals),
// so a forwarded email credits whoever forwarded it.
const REFERRAL_URL = "https://buttondown.com/wikipop?referral_code={{ subscriber.referral_code }}";

// The comic-book layout is sent with Buttondown's "naked" template so our
// HTML isn't wrapped or recolored. EMAIL_DESIGN=classic falls back to the old
// layout. EMAIL_PREVIEW_FILE=path writes the HTML to a file instead of sending.
const EMAIL_DESIGN = process.env.EMAIL_DESIGN || "comic";

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

// Fallback image for articles with no lead image: the first gallery image
// further down the article. Keep in sync with scripts/build.js.
async function fetchFirstArticleImage(title) {
  const url = `https://en.wikipedia.org/api/rest_v1/page/media-list/${encodeURIComponent(title)}`;
  const data = await httpGet(url);
  const item = (data.items || []).find((i) => i.type === "image" && i.showInGallery && i.srcset && i.srcset.length);
  if (!item) return null;
  const src = item.srcset[0].src;
  return src.startsWith("//") ? `https:${src}` : src;
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
    if (!entry.thumbnail) {
      try { entry.thumbnail = await fetchFirstArticleImage(decodeURIComponent(wikiTitle)); } catch (e) {}
    }
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

// "Why was everyone looking at this?" blurb from data/why.json, if there is
// one for this day. Bullets carry Markdown links; everything else is escaped.
function escapeHtml(str) {
  return String(str).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#039;");
}

function buildWhyHtml(article) {
  const whyFile = path.join(__dirname, "..", "data", "why.json");
  if (!fs.existsSync(whyFile)) return "";
  const e = JSON.parse(fs.readFileSync(whyFile, "utf-8"))[article.date];
  if (!e || !e.show || e.title !== article.title || !e.bullets || !e.bullets.length) return "";
  const render = (text) => {
    let html = "";
    let last = 0;
    for (const m of text.matchAll(/\[([^\]]+)\]\((https:\/\/(?:[^()\s]|\([^()\s]*\))+)\)/g)) {
      html += escapeHtml(text.slice(last, m.index));
      html += `<a href="${escapeHtml(m[2])}" style="color:#1a1a1a;text-decoration:underline;text-decoration-color:#c1272d;">${escapeHtml(m[1])}</a>`;
      last = m.index + m[0].length;
    }
    return html + escapeHtml(text.slice(last));
  };
  return `
    <div style="margin:4px 0 16px;padding:14px 16px;background:#fafaf8;border:1px solid #e5e5e5;border-radius:8px;">
      <p style="margin:0 0 6px;font-size:13px;font-weight:700;text-transform:uppercase;letter-spacing:0.5px;color:#c1272d;">Why the popularity?</p>
      <ul style="margin:0;padding-left:20px;font-size:15px;line-height:1.55;color:#333;">
        ${e.bullets.map((b) => `<li style="margin:4px 0;">${render(b)}</li>`).join("\n        ")}
      </ul>
    </div>`;
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

  const html = `<!-- buttondown-editor-mode: fancy -->
<div style="max-width:560px;margin:0 auto;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#1a1a1a;">

  <div style="text-align:center;padding:20px 0 12px;">
    <a href="https://wikipop.sowin.io" style="text-decoration:none;">
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
${buildWhyHtml(article)}
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
      <a href="https://wikipop.sowin.io" style="color:#888;text-decoration:none;">wikipop.sowin.io</a>
      &nbsp;&middot;&nbsp;
      <a href="https://wikipop.sowin.io/explore.html" style="color:#888;text-decoration:none;">Explore</a>
      &nbsp;&middot;&nbsp;
      <a href="https://wikipop.sowin.io/archive.html" style="color:#888;text-decoration:none;">Archive</a>
    </p>
  </div>

</div>`;
  return html;
}

// Comic-book layout matching the site. Email-safe: tables, inline styles,
// web font with system fallbacks, no CSS the big clients strip.
// Softer than the site's yellow, which is glaring as a full email background.
const C = { yellow: "#f4d75e", red: "#d00d00", black: "#111111", cream: "#fdfcf3", gray: "#666666" };
// The logo is an image (rendered in Bangers) because phone mail apps won't load web fonts.
// Same file as assets/email-logo.png, hosted by Buttondown.
const LOGO_URL = "https://assets.buttondown.email/images/2b829be7-b92a-4343-a421-940d32d6a65d.png";
const HEAD_FONT = "Bangers, Impact, 'Arial Black', 'Helvetica Neue', Arial, sans-serif";
const BODY_FONT = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";

function markdownLinks(text, linkStyle) {
  let html = "";
  let last = 0;
  for (const m of text.matchAll(/\[([^\]]+)\]\((https:\/\/(?:[^()\s]|\([^()\s]*\))+)\)/g)) {
    html += escapeHtml(text.slice(last, m.index));
    html += `<a href="${escapeHtml(m[2])}" style="${linkStyle}">${escapeHtml(m[1])}</a>`;
    last = m.index + m[0].length;
  }
  return html + escapeHtml(text.slice(last));
}

function whyEntryFor(article) {
  const whyFile = path.join(__dirname, "..", "data", "why.json");
  if (!fs.existsSync(whyFile)) return null;
  const e = JSON.parse(fs.readFileSync(whyFile, "utf-8"))[article.date];
  return e && e.show && e.title === article.title && e.bullets && e.bullets.length ? e : null;
}

function panel(inner) {
  return `<tr><td style="background:${C.cream};border:3px solid ${C.black};padding:18px 16px 16px;">${inner}</td></tr>
          <tr><td style="height:22px;line-height:22px;font-size:0;">&nbsp;</td></tr>`;
}

function buildComicEmailHtml(article, recentArticles, featured) {
  const title = escapeHtml(displayTitle(article.title));
  const url = escapeHtml(article.url || `https://en.wikipedia.org/wiki/${encodeURIComponent(article.title)}`);
  const dayUrl = escapeHtml(dayAbsoluteUrl(article));
  const why = whyEntryFor(article);
  const linkStyle = `color:${C.black};text-decoration:underline;`;
  const label = (text) => `<div style="font-family:${HEAD_FONT};font-size:17px;letter-spacing:1px;color:${C.red};margin:0 0 4px;">${text}</div>`;

  // Inbox preview text: the first "why" bullet, else the start of the extract.
  const preview = (why ? why.bullets[0].replace(/\[([^\]]+)\]\([^)]*\)/g, "$1") : (article.extract || "")).slice(0, 140);

  const thumb = article.thumbnail
    ? `<img src="${escapeHtml(article.thumbnail)}" alt="" width="120" style="width:120px;max-width:120px;height:auto;float:right;margin:0 0 12px 16px;border:0;">`
    : "";

  const whyBox = why ? `
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:18px 0 4px;">
              <tr><td style="background:#ffffff;border:3px solid ${C.black};padding:14px 16px 10px;">
                <div style="font-family:${HEAD_FONT};font-size:21px;letter-spacing:0.5px;color:${C.black};margin:0 0 6px;">Why the popularity?</div>
                <ul style="margin:0;padding-left:20px;font-family:${BODY_FONT};font-size:15px;line-height:1.55;color:${C.black};">
                  ${why.bullets.map((b) => `<li style="margin:5px 0;">${markdownLinks(b, linkStyle)}</li>`).join("\n                  ")}
                </ul>
              </td></tr>
            </table>` : "";

  const hero = panel(`
            ${label(escapeHtml(formatDateLong(article.date)))}
            <div style="font-family:${HEAD_FONT};font-size:40px;line-height:1.02;letter-spacing:0.5px;margin:0 0 6px;"><a href="${dayUrl}" style="color:${C.black};text-decoration:none;">${title}</a></div>
            ${article.description ? `<div style="font-family:${BODY_FONT};font-size:14px;font-style:italic;color:${C.gray};margin:0 0 14px;">${escapeHtml(article.description)}</div>` : ""}
            ${thumb}
            <div style="font-family:${BODY_FONT};font-size:16px;line-height:1.6;color:#222;">${escapeHtml(article.extract || "")}</div>
            <div style="clear:both;line-height:0;font-size:0;">&nbsp;</div>
            ${whyBox}
            <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:18px 0 0;">
              <tr>
                <td style="background:${C.red};border:3px solid ${C.black};padding:9px 20px;">
                  <a href="${url}" style="font-family:${HEAD_FONT};font-size:20px;letter-spacing:1px;color:#ffffff;text-decoration:none;">Read on Wikipedia &rarr;</a>
                </td>
                <td style="padding-left:16px;font-family:${HEAD_FONT};font-size:20px;letter-spacing:0.5px;color:${C.black};">${formatNumber(article.views)} <span style="font-family:${BODY_FONT};font-size:13px;color:${C.gray};">views</span></td>
              </tr>
            </table>
            <div style="margin:12px 0 0;font-family:${BODY_FONT};font-size:14px;"><a href="${dayUrl}" style="color:${C.red};font-weight:700;text-decoration:none;">See the full top 10 &rarr;</a></div>`);

  const obscure = featured ? panel(`
            ${label("Obscure entry of the day")}
            <div style="font-family:${HEAD_FONT};font-size:30px;line-height:1.05;letter-spacing:0.5px;margin:0 0 10px;"><a href="${escapeHtml(featured.url)}" style="color:${C.black};text-decoration:none;">${escapeHtml(displayTitle(featured.title))}</a></div>
            ${featured.thumbnail ? `<img src="${escapeHtml(featured.thumbnail)}" alt="" width="100" style="width:100px;max-width:100px;height:auto;float:right;margin:0 0 10px 14px;border:0;">` : ""}
            <div style="font-family:${BODY_FONT};font-size:15px;line-height:1.6;color:#222;">${escapeHtml(featured.extract || "")} <a href="${escapeHtml(featured.url)}" style="color:${C.red};font-weight:700;text-decoration:none;">Continue reading &rarr;</a></div>
            <div style="clear:both;line-height:0;font-size:0;">&nbsp;</div>`) : "";

  return `<!-- buttondown-editor-mode: naked -->
<link href="https://fonts.googleapis.com/css2?family=Bangers&display=swap" rel="stylesheet">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;mso-hide:all;">${escapeHtml(preview)}${"&zwnj;&nbsp;".repeat(60)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${C.yellow}" style="background:${C.yellow};">
  <tr>
    <td align="center" style="padding:22px 0 28px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;">
        <tr>
          <td align="center" style="padding:0 0 22px;">
            <a href="https://wikipop.sowin.io" style="text-decoration:none;"><img src="${LOGO_URL}" alt="WikiPop!" width="157" height="53" style="display:inline-block;width:157px;height:53px;border:0;"></a>
            <div style="font-family:${HEAD_FONT};font-size:20px;line-height:1.15;letter-spacing:1px;color:${C.black};margin:10px 0 0;">Yesterday's Most Popular<br>Wikipedia Page</div>
          </td>
        </tr>
        ${hero}
        ${obscure}
        <tr>
          <td align="center" style="font-family:${BODY_FONT};font-size:13px;color:${C.black};padding:2px 0 0;">
            <div style="font-size:14px;line-height:1.55;margin:0 0 14px;">
              <strong>Got this from a friend?</strong> <a href="${REFERRAL_URL}" style="color:${C.black};font-weight:700;">Get WikiPop every morning</a>, free.<br>
              Know someone who'd like it? Forward this email or send them <a href="${REFERRAL_URL}" style="color:${C.black};">your invite link</a>.
            </div>
            <div><a href="{{ unsubscribe_url }}" style="font-size:11px;color:#777777;text-decoration:underline;">Unsubscribe</a></div>
          </td>
        </tr>
      </table>
    </td>
  </tr>
</table>`;
}

function sendEmail(subject, body, isTest = false) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify({
      subject,
      body,
      status: isTest ? "draft" : "about_to_send",
      ...(EMAIL_DESIGN === "comic" ? { template: "naked" } : {}),
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
          console.log(`Email ${isTest ? 'draft created' : 'sent'}! Status: ${res.statusCode}`);
          try {
            const parsed = JSON.parse(data);
            console.log(`  ID: ${parsed.id}`);
            console.log(`  Subject: ${parsed.subject}`);
            resolve(parsed);
          } catch {
            resolve(data);
          }
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

function sendDraftTest(emailId, testEmailAddress) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify({
      recipients: [testEmailAddress],
    });

    const options = {
      hostname: "api.buttondown.com",
      port: 443,
      path: `/v1/emails/${emailId}/send-draft`,
      method: "POST",
      headers: {
        Authorization: `Token ${API_KEY}`,
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(payload),
      },
    };

    const req = https.request(options, (res) => {
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          console.log(`Test email successfully sent to ${testEmailAddress}!`);
          resolve(data);
        } else {
          console.error(`Failed to send test email. Status: ${res.statusCode}`);
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

  // Get the latest article (or, for previews only, a chosen day).
  const latest = process.env.EMAIL_PREVIEW_FILE && process.env.EMAIL_PREVIEW_DATE
    ? articles.find((a) => a.date === process.env.EMAIL_PREVIEW_DATE)
    : articles[articles.length - 1];
  if (!latest) {
    console.error("No articles found");
    process.exit(1);
  }

  if (fs.existsSync(LAST_EMAIL_FILE) && !process.env.TEST_EMAIL_TO) {
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

  const body = EMAIL_DESIGN === "comic"
    ? buildComicEmailHtml(latest, recentArticles, featured)
    : buildEmailHtml(latest, recentArticles, featured);

  if (process.env.EMAIL_PREVIEW_FILE) {
    fs.writeFileSync(process.env.EMAIL_PREVIEW_FILE, body);
    console.log(`Wrote preview to ${process.env.EMAIL_PREVIEW_FILE} (nothing sent).`);
    return;
  }

  const testEmailTo = process.env.TEST_EMAIL_TO;
  if (testEmailTo) {
    console.log(`TEST MODE: Creating draft and sending test to ${testEmailTo}`);
    // A unique prefix keeps Gmail from threading tests together and hiding repeated parts.
    const testSubject = `[Test ${Math.floor(Math.random() * 9000) + 1000}] ${subject}`;
    const draftResponse = await sendEmail(testSubject, body, true);
    if (draftResponse && draftResponse.id) {
      await sendDraftTest(draftResponse.id, testEmailTo);
    } else {
      console.error("Failed to get draft ID, cannot send test email.");
    }
  } else {
    await sendEmail(subject, body, false);
    fs.writeFileSync(LAST_EMAIL_FILE, todayStr + "|" + latest.date + "\n");
  }
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

module.exports = { buildComicEmailHtml };
