// "Why was everyone looking at this?" — explains each day's WikiPop pick in
// 2–4 short bullets, in two steps with Claude Sonnet 5.5:
//   1. Research (with web search): what happened, candidate facts with
//      sources, and a confidence score. Low-confidence days get no blurb.
//   2. Editor (no tools): picks the best few facts and writes the bullets in
//      the WikiPop voice, following the rules and examples below.
//
// Wikipedia is the first source: we hand the researcher the article's recent
// edits, any passages mentioning the current year, and matching lines from
// Wikipedia's Current events portal. Web search fills in the rest.
//
// Writes to data/why.json, which the site build and daily email read.
//
// Usage:
//   node --env-file=.env scripts/why.mjs --latest 1
//   node --env-file=.env scripts/why.mjs --dates 2026-10-18,2026-10-17
//   --force          regenerate days that already have a blurb
//   --out <file>     write somewhere else (e.g. a drafts file for review)
//   --with-notes     also save the research notes (needed for --rewrite)
//   --rewrite        re-run only the editor on saved research notes (cheap)
import fs from "node:fs";
import path from "node:path";
import https from "node:https";
import { fileURLToPath } from "node:url";
import Anthropic from "@anthropic-ai/sdk";

const here = path.dirname(fileURLToPath(import.meta.url));
const ARTICLES_FILE = path.join(here, "..", "data", "articles.json");
const DEFAULT_OUT_FILE = path.join(here, "..", "data", "why.json");
const MODEL = "claude-sonnet-5-5";

// Sites the blurbs may cite and link to, besides Wikipedia and any .gov site.
// The prompts list them, and cleanLinks() removes any other link (keeping its
// text). YouTube is for official uploads only; the prompts say so.
const ALLOWED_DOMAINS = [
  // Wire services and public broadcasters
  "apnews.com", "reuters.com", "afp.com", "npr.org", "pbs.org", "bbc.com", "bbc.co.uk",
  // US news
  "nytimes.com", "washingtonpost.com", "wsj.com", "bloomberg.com", "cnn.com", "cbsnews.com",
  "nbcnews.com", "abcnews.com", "abcnews.go.com", "politico.com", "axios.com", "usatoday.com",
  "latimes.com", "time.com", "propublica.org", "csmonitor.com", "cnbc.com",
  // International
  "cbc.ca", "dw.com", "france24.com", "abc.net.au", "nhk.or.jp", "straitstimes.com", "ft.com",
  "economist.com",
  // India
  "thehindu.com", "indianexpress.com", "ndtv.com", "timesofindia.indiatimes.com",
  "hindustantimes.com", "indiatoday.in", "livemint.com", "theweek.in", "deccanherald.com",
  // Film, TV and music
  "variety.com", "hollywoodreporter.com", "deadline.com", "rollingstone.com", "billboard.com",
  "ew.com", "indiewire.com", "vulture.com", "pitchfork.com",
  // Sports
  "espn.com", "nfl.com", "nba.com", "mlb.com", "nhl.com", "fifa.com", "uefa.com", "olympics.com",
  "wwe.com",
  // Science and tech
  "quantamagazine.org", "nature.com", "scientificamerican.com", "science.org", "newscientist.com",
  "arstechnica.com", "theverge.com", "wired.com", "technologyreview.com",
  // Official sources (plus any .gov site, see isAllowedHost)
  "un.org", "who.int", "nobelprize.org", "oscars.org",
  // Games
  "polygon.com", "eurogamer.net",
  "youtube.com",
];

function isAllowedHost(host) {
  return /\.gov(\.[a-z]{2})?$/.test(host)
    || ALLOWED_DOMAINS.some((d) => host === d || host.endsWith("." + d));
}

// Blurbs below this confidence stay hidden. Better to show nothing than
// to be wrong.
const MIN_CONFIDENCE = 80;

const SOURCES_POLICY = `Sources, in order of preference:
1. Primary and official sources: the official YouTube channel for a trailer or clip (the studio's, label's, league's or person's own channel), an official site, a government, league or organization page.
2. Wikipedia itself, including related articles (a film, an event, a person).
3. Wire services and straight-news outlets: AP News first, then Reuters, AFP, NPR, PBS NewsHour and BBC News, then major national newspapers and networks.
4. Respected specialists for the topic, such as film and music trades, sports leagues and science publications.
Use only Wikipedia, government (.gov) sites and these sites: ${ALLOWED_DOMAINS.join(", ")}. If a fact only appears elsewhere, leave it out.`;

const RESEARCH_SYSTEM = `You research the "Why was everyone looking at this?" blurb for WikiPop, a site that features the most-viewed English Wikipedia article each day. An editor will turn your notes into the final blurb, so gather good raw material; don't write the blurb yourself.

Find the real-world reason people were reading this article on this date. The user message includes recent edits to the article and Wikipedia's Current events entries. Search for news from that date and the few days before. Big spikes almost always have a human cause: a release, a death, an announcement, a viral moment, a person or thing with the same name in the news, or a wider trend. If the obvious story doesn't fit, keep digging for the connection rather than guessing.

${SOURCES_POLICY}

Collect 6 to 10 facts the editor can choose from: the trigger itself, then the most surprising, human or delightful details, and how people reacted. Prefer what a curious reader would want to tell a friend over background. Don't collect plot details of films, TV, books or games beyond the premise.

Rate your confidence from 0 to 100 that the trigger explains why people were reading the article on that date. Rate the cause, not just whether the facts are true. An event clearly about this subject on that date or up to three days before (a release, death, announcement, game or viral moment) counts as tied to the date. Go above 90 only when a source or Wikipedia ties the event to the date that directly. Stay under 80 when the connection is your own inference, or when the event seems too small for the number of views.

Output exactly this format, using URLs exactly as they appeared in your search results:
TRIGGER: <what happened and when> (<source URL>)
FACTS:
- <fact> (<source URL>)
LINKS:
- <name>: <English Wikipedia URL for a person, work, organization, event or place mentioned in the facts>
CONFIDENCE: <number>`;

// The editor's instructions.
const EDITOR_SYSTEM = (() => {
  return `You are the editor of the "Why was everyone looking at this?" blurb on WikiPop, a site that features the most-viewed English Wikipedia article each day. A researcher has gathered notes. Write the blurb from them.

Voice:
- Write like a sharp friend explaining why everyone's talking about this: conversational, punchy and a little playful. Plain everyday words, no jargon.
- Three bullets is ideal, four at most. One sentence each, around 20 words at most.
- First bullet: the hook. What happened, framed so a reader instantly gets why everyone was looking.
- Then the most surprising, human or delightful details. Choose, don't summarize: most of the notes should be left out.

What to leave out:
- Keep a fact only if it explains why people were looking right now, or it's something a reader would want to tell a friend. Drop background like legal status, sentences, schedules, procedures, production history, cast lists, release formats and soundtrack details.
- Keep specifics light. No exact times, addresses, official titles or minor dates and figures. One headline number is fine if it's impressive, but a number or record needs a source link in the same bullet; otherwise leave it out.
- Never mention the spike, page views, traffic, "this article", Wikipedia as a source, or the research ("couldn't confirm", "sources said").

Sensitive topics:
- Deaths: warm and respectful, in the past tense. Who they were, what people loved them for, one human detail, and how others are remembering them. No logistics such as where or when they died, who declared it, or autopsies. Leave out the cause unless it is the confirmed central story, and always leave it out if it was suicide.
- Politics and controversy: neutral and factual. If a slip or awkward moment is what people were talking about, mention it once, plainly, without mocking quotes or pile-on phrases like "the internet pounced."
- Disasters and violence: plain and serious, never playful.
- No spoilers for films, TV, books or games. Give the premise in one line, as a trailer would. Never say what happens in the story, who shows up or how it ends.

${SOURCES_POLICY}

Links (Markdown):
- Link every person, work, organization, event or place in the story that has an English Wikipedia URL in the notes, the first time it appears: [Name](https://en.wikipedia.org/wiki/Title). Don't link news outlets, networks or shows that only appear as where something was said or reported.
- Put the news or primary source link on the words that make the claim, e.g. "[premiered on YouTube](https://...)". Use only URLs from the notes. Link each URL once.
- Never link the day's article itself; its title is already a link.
- Use "reportedly" only for claims that are genuinely unconfirmed.

Examples of the voice (other days; never reuse their facts):

Film release:
- [Christopher Nolan](https://en.wikipedia.org/wiki/Christopher_Nolan)'s [Oppenheimer](https://en.wikipedia.org/wiki/Oppenheimer_(film)) opened the same day as [Barbie](https://en.wikipedia.org/wiki/Barbie_(film)), and "[Barbenheimer](https://en.wikipedia.org/wiki/Barbenheimer)" double features took over the weekend.
- [Cillian Murphy](https://en.wikipedia.org/wiki/Cillian_Murphy) plays the physicist who led the [Manhattan Project](https://en.wikipedia.org/wiki/Manhattan_Project)'s race to build the atomic bomb.
- Nolan shot parts of it on black-and-white IMAX film that Kodak created just for the movie.

Death:
- [Matthew Perry](https://en.wikipedia.org/wiki/Matthew_Perry), forever [Chandler Bing](https://en.wikipedia.org/wiki/Chandler_Bing) to a generation of [Friends](https://en.wikipedia.org/wiki/Friends) fans, died at 54.
- He wrote openly about his addiction in a bestselling memoir and said he hoped to be remembered for helping others get sober.
- His Friends castmates said they were "utterly devastated" and "more than just cast mates."

Event:
- A [total solar eclipse](https://en.wikipedia.org/wiki/Solar_eclipse_of_April_8,_2024) swept from Mexico across the US to Canada, turning midday into twilight for millions.
- People road-tripped for hours to stand in the path of totality, where the sky went dark for up to four minutes.
- Missed it? The next one visible across the continental US isn't until 2044.

Before answering, check every bullet against these rules and fix any that break one.

Return the bullets as JSON: {"bullets": ["...", "..."]}.`;
})();

// Wikimedia rate-limits bursts; back off and retry on 429.
async function httpGetJson(url, attempts = 4) {
  for (let i = 1; ; i++) {
    try {
      return await httpGetJsonOnce(url);
    } catch (err) {
      if (i >= attempts || !/HTTP 429/.test(err.message)) throw err;
      await new Promise((r) => setTimeout(r, 5000 * i));
    }
  }
}

function httpGetJsonOnce(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { "User-Agent": "WikiPop/1.0 (https://wikipop.sowin.io; daily top article)" } }, (res) => {
      if (res.statusCode !== 200) {
        reject(new Error(`HTTP ${res.statusCode} for ${url}`));
        res.resume();
        return;
      }
      let data = "";
      res.on("data", (c) => (data += c));
      res.on("end", () => {
        try { resolve(JSON.parse(data)); } catch (e) { reject(e); }
      });
    }).on("error", reject);
  });
}

function wikiApi(params) {
  const qs = new URLSearchParams({ ...params, format: "json", formatversion: "2" });
  return httpGetJson(`https://en.wikipedia.org/w/api.php?${qs}`);
}

function shiftDate(dateStr, days) {
  const d = new Date(dateStr + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d;
}

function stripHtml(html) {
  return html
    .replace(/<[^>]+>/g, "")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'").replace(/&amp;/g, "&");
}

// Text added to the article in the week leading up to (and just after) the
// spike, as raw wikitext with references and templates stripped.
async function recentAdditions(title, date) {
  const revAt = async (when) => {
    const data = await wikiApi({
      action: "query", prop: "revisions", titles: title, rvlimit: 1,
      rvdir: "older", rvstart: when.toISOString(), rvprop: "ids", redirects: 1,
    });
    return data.query?.pages?.[0]?.revisions?.[0]?.revid;
  };
  const from = await revAt(shiftDate(date, -6));
  const to = await revAt(shiftDate(date, 2));
  if (!from || !to || from === to) return "";
  const cmp = await wikiApi({ action: "compare", fromrev: from, torev: to });
  const body = cmp.compare?.body || "";
  const added = [...body.matchAll(/<td class="diff-addedline[^"]*"[^>]*>([\s\S]*?)<\/td>/g)]
    .map((m) => stripHtml(m[1])
      .replace(/<ref[^>]*\/>/g, "")
      .replace(/<ref[^>]*>[\s\S]*?<\/ref>/g, "")
      .replace(/\{\{[^{}]*\}\}/g, "")
      .trim())
    .filter((l) => l.length > 40);
  return added.join("\n").slice(0, 3000);
}

// Paragraphs of the article that mention the spike's year, newest context first.
async function yearMentions(title, date) {
  const data = await wikiApi({ action: "query", prop: "extracts", explaintext: 1, titles: title, redirects: 1 });
  const text = data.query?.pages?.[0]?.extract || "";
  const year = date.slice(0, 4);
  return text.split("\n")
    .filter((p) => p.includes(year) && p.length > 60)
    .slice(-6)
    .join("\n")
    .slice(0, 2500);
}

// Lines from Wikipedia's Current events portal (the day and the day before)
// that mention a word from the article title.
async function currentEvents(title, date) {
  const words = title.replace(/_/g, " ").replace(/[()]/g, "").split(/\s+/).filter((w) => w.length > 3);
  const lines = [];
  for (const offset of [0, -1]) {
    const d = shiftDate(date, offset);
    const portal = `Portal:Current_events/${d.getUTCFullYear()}_${d.toLocaleDateString("en-US", { month: "long", timeZone: "UTC" })}_${d.getUTCDate()}`;
    try {
      const data = await wikiApi({ action: "query", prop: "extracts", explaintext: 1, titles: portal });
      const text = data.query?.pages?.[0]?.extract || "";
      for (const l of text.split("\n")) {
        if (words.some((w) => l.toLowerCase().includes(w.toLowerCase()))) lines.push(l.trim());
      }
    } catch {}
  }
  return lines.join("\n").slice(0, 1500);
}

async function wikipediaContext(a) {
  const safe = (p) => p.catch(() => "");
  const additions = await safe(recentAdditions(a.title, a.date));
  const mentions = await safe(yearMentions(a.title, a.date));
  const events = await safe(currentEvents(a.title, a.date));
  return [
    additions && `Recently added to the Wikipedia article (wikitext):\n${additions}`,
    mentions && `Passages in the article mentioning ${a.date.slice(0, 4)}:\n${mentions}`,
    events && `Wikipedia Current events entries that may be related:\n${events}`,
  ].filter(Boolean).join("\n\n");
}

function buildPrompt(a, wikiContext) {
  const name = a.title.replace(/_/g, " ");
  const weekday = new Date(a.date + "T00:00:00Z").toLocaleDateString("en-US", { weekday: "long", timeZone: "UTC" });
  const others = (a.top10 || [])
    .filter((t) => t.title !== a.title)
    .slice(0, 6)
    .map((t) => `${t.title.replace(/_/g, " ")}${t.description ? ` (${t.description})` : ""}`)
    .join("; ");
  return [
    `Article: ${name}${a.description ? ` — ${a.description}` : ""}`,
    `URL: ${a.url}`,
    `Date of the spike: ${weekday}, ${a.date}`,
    `Views that day: ${a.views.toLocaleString("en-US")}`,
    others ? `Other most-read articles that day: ${others}` : "",
    a.extract ? `Opening of the article: ${a.extract.slice(0, 600)}` : "",
    wikiContext,
  ].filter(Boolean).join("\n\n");
}

const MEDIA_OUTLET = /\b(news\b[\w\s-]{0,30}\b(channel|network|agency|website|organization|company|outlet|service)|cable news|newspaper|magazine|broadcaster|television (channel|network)|cable (channel|network)|radio (station|network)|wire service)\b/i;

// Drop links that aren't https, Wikipedia pages that don't exist or are
// disambiguation pages, the day's own article (its title already links
// there), news outlets, and anything outside ALLOWED_DOMAINS.
async function cleanLinks(bullet, ownTitle) {
  const links = [...bullet.matchAll(/\[([^\]]+)\]\(((?:[^()\s]|\([^()\s]*\))+)\)/g)];
  let out = bullet;
  for (const [whole, text, url] of links) {
    let parsed = null;
    try { parsed = new URL(url); } catch {}
    const wiki = url.match(/^https:\/\/en\.wikipedia\.org\/wiki\/(.+)$/);
    let keep = parsed?.protocol === "https:"
      && (Boolean(wiki) || isAllowedHost(parsed.hostname.replace(/^www\./, "")));
    if (keep && wiki) {
      try {
        // The summary endpoint follows redirects, so canonical catches links
        // to the day's article made through a redirect.
        const page = await httpGetJson(`https://en.wikipedia.org/api/rest_v1/page/summary/${wiki[1]}`);
        if (page.type === "disambiguation" || page.titles?.canonical === ownTitle) keep = false;
        // News outlets only appear as where something was said; linking them adds nothing.
        if (MEDIA_OUTLET.test(page.description || "")) keep = false;
      } catch {
        keep = false;
      }
    }
    if (!keep) out = out.replace(whole, text);
  }
  return out;
}

// Sonnet 5.5 list prices: $2 / $10 per MTok, web search $10 per 1,000.
function addUsage(usage, response) {
  usage.input += response.usage.input_tokens + (response.usage.cache_read_input_tokens || 0);
  usage.output += response.usage.output_tokens;
  usage.searches += response.usage.server_tool_use?.web_search_requests || 0;
}
const costOf = (u) => Math.round(((u.input * 2 + u.output * 10) / 1e6 + u.searches * 0.01) * 1000) / 1000;

function textOf(response) {
  let text = "";
  for (const block of response.content) {
    if (block.type === "text") text += block.text;
  }
  return text;
}

function checkRefusal(response) {
  if (response.stop_reason === "refusal") {
    throw new Error(`refused (${response.stop_details?.category ?? "unknown"})`);
  }
}

// Step 1: research notes with web search.
async function research(client, a, usage) {
  const messages = [{ role: "user", content: buildPrompt(a, await wikipediaContext(a)) }];
  let response;
  let searchOk = 0;
  let searchErrors = 0;
  // Server-side web search can pause long turns; resume a few times at most.
  for (let i = 0; i < 4; i++) {
    response = await client.beta.messages.create({
      model: MODEL,
      max_tokens: 8000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      output_config: { effort: "high" },
      system: RESEARCH_SYSTEM,
      tools: [{ type: "web_search_20260209", name: "web_search", max_uses: 6 }],
      messages,
    });
    addUsage(usage, response);
    for (const block of response.content) {
      // Search errors come back as a result block holding an error object.
      if (block.type === "web_search_tool_result") Array.isArray(block.content) ? searchOk++ : searchErrors++;
    }
    if (response.stop_reason !== "pause_turn") break;
    messages.push({ role: "assistant", content: response.content });
  }
  checkRefusal(response);
  // If search was failing, the notes can't be trusted. Fail the day so the
  // next run tries again, rather than saving it as "unclear".
  if (searchErrors > searchOk) {
    throw new Error(`web search was failing (${searchErrors} errors, ${searchOk} ok)`);
  }
  // With web_search_20260209 the results are filtered server-side and the
  // text carries no citations, so sources come from the URLs in the notes.
  const notes = textOf(response).trim();
  const confidence = parseInt((notes.match(/CONFIDENCE:\s*(\d+)/) || [])[1] || "0", 10);
  return { notes, confidence };
}

// Step 2: the editor writes the bullets from the notes.
async function edit(client, a, notes, usage) {
  const name = a.title.replace(/_/g, " ");
  const response = await client.beta.messages.create({
    model: MODEL,
    max_tokens: 16000,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    // Extra-high effort won 67% of blind comparisons against high, for about
    // a cent or two more per day.
    output_config: {
      effort: "xhigh",
      format: {
        type: "json_schema",
        schema: {
          type: "object",
          properties: { bullets: { type: "array", items: { type: "string" } } },
          required: ["bullets"],
          additionalProperties: false,
        },
      },
    },
    system: EDITOR_SYSTEM,
    messages: [{
      role: "user",
      content: `Today's article: ${name}${a.description ? ` — ${a.description}` : ""} (${a.url})\nDate: ${a.date}\n\nResearch notes:\n${notes}`,
    }],
  });
  addUsage(usage, response);
  checkRefusal(response);
  let parsed;
  try {
    parsed = JSON.parse(textOf(response));
  } catch {
    throw new Error(`editor returned no usable JSON (stop reason: ${response.stop_reason})`);
  }
  const raw = parsed.bullets
    .map((b) => b.replace(/^[-•]\s*/, "").trim())
    .filter(Boolean)
    .slice(0, 4);
  const bullets = [];
  for (const b of raw) bullets.push(await cleanLinks(b, a.title));
  return bullets;
}

async function explain(client, a, saved) {
  const usage = { input: 0, output: 0, searches: 0 };
  const { notes, confidence } = saved || await research(client, a, usage);
  const show = confidence >= MIN_CONFIDENCE;
  // Days below the bar get no blurb, so skip the editor.
  const bullets = show ? await edit(client, a, notes, usage) : [];

  const sources = [];
  for (const b of bullets) {
    for (const m of b.matchAll(/\]\(((?:[^()\s]|\([^()\s]*\))+)\)/g)) {
      if (!m[1].startsWith("https://en.wikipedia.org/") && !sources.includes(m[1])) sources.push(m[1]);
    }
  }

  return {
    date: a.date,
    title: a.title,
    show,
    confidence,
    bullets,
    sources,
    model: MODEL,
    generatedAt: new Date().toISOString(),
    notes,
    usage: { ...usage, costUsd: costOf(usage) },
  };
}

async function main() {
  const args = process.argv.slice(2);
  const flag = (name) => args.includes(name);
  const value = (name) => (flag(name) ? args[args.indexOf(name) + 1] : null);

  const outFile = value("--out") ? path.resolve(value("--out")) : DEFAULT_OUT_FILE;
  const articles = JSON.parse(fs.readFileSync(ARTICLES_FILE, "utf-8"));
  const saved = fs.existsSync(outFile) ? JSON.parse(fs.readFileSync(outFile, "utf-8")) : {};

  let targets;
  if (flag("--dates")) {
    const dates = new Set(value("--dates").split(","));
    targets = articles.filter((a) => dates.has(a.date));
  } else {
    const n = flag("--latest") ? parseInt(value("--latest"), 10) : 1;
    targets = [...articles].sort((a, b) => b.date.localeCompare(a.date)).slice(0, n);
  }

  if (flag("--context-only")) {
    // Print the Wikipedia context we'd send, without calling the API.
    for (const a of targets) console.log(`==== ${a.date} ${a.title}\n${await wikipediaContext(a)}\n`);
    return;
  }

  // Extra retries so a brief network blip doesn't sink the daily run.
  const client = new Anthropic({ maxRetries: 5 });
  for (const a of targets) {
    const prev = saved[a.date] && saved[a.date].title === a.title ? saved[a.date] : null;
    if (prev && !flag("--force") && !flag("--rewrite")) {
      console.log(`${a.date}: already done, skipping (use --force to redo).`);
      continue;
    }
    if (flag("--rewrite") && !prev?.notes) {
      console.log(`${a.date}: no saved research notes to rewrite from, skipping.`);
      continue;
    }
    try {
      const d = await explain(client, a, flag("--rewrite") ? prev : null);
      const body = d.bullets.length ? `\n  - ${d.bullets.join("\n  - ")}` : " (no blurb)";
      console.log(`${a.date} ${a.title} (confidence ${d.confidence}${d.show ? "" : ", hidden"}; ${d.usage.searches} searches, ~$${d.usage.costUsd}):${body}`);
      // The published file keeps only what the site needs.
      if (!flag("--with-notes")) {
        delete d.notes;
        delete d.usage;
      }
      saved[a.date] = d;
      fs.writeFileSync(outFile, JSON.stringify(saved, null, 2) + "\n");
    } catch (err) {
      if (err instanceof Anthropic.AuthenticationError) throw err;
      console.log(`${a.date}: failed (${err.message})`);
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
