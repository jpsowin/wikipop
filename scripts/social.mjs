// Daily Instagram carousels for WikiPop, scheduled through Publer.
//
// Each morning, after the daily job commits the day's data, this renders two carousels
// (1080x1440 PNGs, made with headless Chrome from social/slides.mjs + social/slides.css):
//   1. WikiPop (trending): cover + "What happened" bullets. Goes out ~8:00 AM Pacific.
//   2. Obscure: the day's obscure entry, from the hand-curated data/obscure-slides.json.
//      Goes out 5 minutes later, so the owner can share both to stories by hand.
// If the job runs late, the first post goes out 10 minutes from now and the second 5 minutes after.
// Rules for the copy and images live in social/RULES.md.
//
// Usage:
//   node scripts/social.mjs render                   today's pair → social/out/<date>/ (PNGs + post.json)
//   node scripts/social.mjs post                     render, upload to Publer, schedule (needs PUBLER_API_KEY)
//   --date YYYY-MM-DD   the day the pick appeared on the site (the article's data date + 1), for testing
//   --obscure "Title"   use this obscure entry instead of the queue's pick for that day
//   --dry-run           with post: print what would be sent, no calls to Publer
//   CHROME=/path/to/chrome overrides the browser binary.
//
// data/why.json entries (written by scripts/why.mjs) may carry these OPTIONAL fields for social:
//   hook     cover line under the title, ≤70 characters (written by why.mjs). Default: the first
//            bullet or its first clause if short enough, else Wikipedia's short description.
//   caption  one or two sentences, starting "Title: ...". Default: "<Title>: <first bullet>".
//   imgPos   CSS object-position for the cover photo. Default "50% 20%" ("50% 100%" for posters).
//   hard     true: always a Publer draft for review; false: never auto-flag. Default: keyword check.
//
// data/obscure-slides.json, keyed by entry title:
//   { slide1: {text}, slide2?: {heading, paras[]}, slide3?: {heading, paras[]},  (slide 1 + at least one more)
//     extraSlides: [{heading, paras[], image: {file, artist, license}, imgPos, imgZoom}],
//     caption, image: {file, artist, license} | null, imgPos, imgZoom, hard }
//   [[double brackets]] mark a highlight. Entries without curated slides are skipped, never posted raw.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import * as S from '../social/slides.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..');
const DATA = path.join(ROOT, 'data');
const OUT_ROOT = path.join(ROOT, 'social', 'out');

const PUBLER = 'https://app.publer.com/api/v1';
const WORKSPACE_ID = '6aed2a8d29e54cb125898f16';
const IG_ACCOUNT_ID = '6aed306842d3fcd3bde900b3';
const TZ = 'America/Los_Angeles';
const FIRST_SLOT = [8, 0]; // 8:00 AM Pacific
const GAP_MS = 5 * 60e3; // obscure 5 minutes after the WikiPop post
const UA = 'WikiPop/1.0 (https://wikipop.sowin.io; daily Instagram post)';

// ---------- args ----------
const argv = process.argv.slice(2);
const flag = name => argv.includes(name);
const opt = name => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : undefined; };
const MODE = argv.find(a => a === 'render' || a === 'post') || 'render';
const DRY = flag('--dry-run');
const DATE_ARG = opt('--date');
const OBSCURE_ARG = opt('--obscure');
const GH = !!process.env.GITHUB_ACTIONS;
const warn = m => console.log(GH ? `::warning::${m}` : `WARNING: ${m}`);
const fail = m => console.log(GH ? `::error::${m}` : `ERROR: ${m}`);

// ---------- small helpers ----------
const readJson = (f, d) => (fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : d);
const addDays = (d, n) => new Date(Date.parse(d + 'T00:00:00Z') + n * 864e5).toISOString().slice(0, 10);
const daysBetween = (a, b) => Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 864e5);
const displayTitle = t => t.replace(/_/g, ' ');
const plain = s => s.replace(/\[\[|\]\]/g, '');
const words = s => plain(s).trim().split(/\s+/).filter(Boolean).length;

function viewsShort(n) {
  if (n >= 999500) { const m = n / 1e6; return (m >= 10 ? Math.round(m) : m.toFixed(1).replace(/\.0$/, '')) + 'M'; }
  if (n >= 1000) return Math.round(n / 1000) + 'K';
  return String(n);
}
function viewsLong(n) {
  if (n >= 999500) return `${(n / 1e6).toFixed(1).replace(/\.0$/, '')} million`;
  if (n >= 1000) return (Math.round(n / 1000) * 1000).toLocaleString('en-US');
  return n.toLocaleString('en-US');
}

function decodeEntities(s) {
  return s.replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#0?39;|&apos;/g, "'")
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)));
}
const stripTags = s => decodeEntities(String(s || '').replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();

// Markdown bullet from why.json → plain text with [[highlights]]. Links become plain words (no blue);
// a link to a news source (not Wikipedia) usually marks the story's key phrase, so it becomes the highlight.
function mdToMarked(md) {
  let s = md.replace(/\[([^\]]+)\]\(([^()\s]+(?:\([^()\s]*\)[^()\s]*)*)\)/g, (_, text, url) =>
    /wikipedia\.org/.test(url) ? text : `[[${text}]]`);
  s = s.replace(/\*\*(.+?)\*\*/g, '$1').replace(/(^|\s)\*(\S.*?)\*/g, '$1$2').replace(/\[\d+\]/g, '');
  return s.replace(/\s+/g, ' ').trim();
}

// Highlights: 3-10 words, at most one per bullet and `max` per slide.
function limitHighlights(items, max = 2) {
  let used = 0;
  return items.map(s => {
    let inThis = false;
    return s.replace(/\[\[(.+?)\]\]/g, (_, t) => {
      const n = t.trim().split(/\s+/).length;
      if (inThis || used >= max || n < 3 || n > 10) return t;
      inThis = true; used++;
      return `[[${t}]]`;
    });
  });
}

const STOP = new Set(['a', 'an', 'the', 'and', 'or', 'but', 'of', 'in', 'on', 'at', 'to', 'for', 'with', 'by', 'from', 'as', 'that', 'which', 'who', 'is', 'was', 'were', 'are', 'his', 'her', 'its', 'their', 'into', 'than', 'so']);

// Cut text (may contain [[ ]]) to ≤max visible characters. Prefer a clause break, else a word break.
// Never leaves "..." (rule): the cut sentence just ends with a period.
function trimTo(s, max) {
  if (plain(s).length <= max) return s;
  // Map visible length to raw index.
  let vis = 0, cutRaw = s.length;
  for (let i = 0; i < s.length; i++) {
    if (s.startsWith('[[', i) || s.startsWith(']]', i)) { i++; continue; }
    if (++vis > max) { cutRaw = i; break; }
  }
  let head = s.slice(0, cutRaw);
  const clause = Math.max(head.lastIndexOf(', '), head.lastIndexOf('; '), head.lastIndexOf(' — '), head.lastIndexOf(' – '));
  const conj = Math.max(...[' so ', ' because ', ' while ', ' which ', ' after ', ' before ', ' when ', ' as ', ' and ', ' but '].map(c => head.lastIndexOf(c)));
  if (clause > head.length * 0.55) head = head.slice(0, clause);
  else if (conj > head.length * 0.5) head = head.slice(0, conj);
  else head = head.slice(0, Math.max(head.lastIndexOf(' '), 1));
  head = head.replace(/[\s,;:—–-]+$/, '');
  let ws = head.split(' ');
  while (ws.length > 3 && STOP.has(plain(ws[ws.length - 1]).toLowerCase().replace(/[^a-z]/g, ''))) ws.pop();
  head = ws.join(' ').replace(/[\s,;:—–-]+$/, '');
  if ((head.match(/\[\[/g) || []).length > (head.match(/\]\]/g) || []).length) head += ']]';
  if ((head.match(/\(/g) || []).length > (head.match(/\)/g) || []).length) head = head.slice(0, head.lastIndexOf('(')).trim();
  if ((plain(head).match(/"/g) || []).length % 2) head += '"';
  return /[.!?]["”')\]]*$/.test(plain(head)) ? head : head + '.';
}

// Sentences from a Wikipedia extract, without parentheticals (dates, pronunciations, foreign names).
function extractSentences(text) {
  const t = String(text || '').replace(/\s*\([^()]*\)/g, '').replace(/\s*\([^()]*\)/g, '').replace(/\s+/g, ' ').trim();
  const out = []; let start = 0;
  const re = /[.!?]["”]?\s+(?=[A-Z0-9"“])/g; let m;
  while ((m = re.exec(t))) {
    const before = t.slice(start, m.index + 1);
    const lastWord = before.split(' ').pop();
    if (/^([A-Z]\.|[A-Z]\.[A-Z]\.|(Mr|Mrs|Ms|Dr|St|Jr|Sr|vs|Inc|Ltd|Co|No|Mt|Gen|Lt|Col|Sgt|U\.S|U\.K)\.)$/.test(lastWord)) continue;
    out.push(before.trim()); start = m.index + m[0].length;
  }
  if (start < t.length) out.push(t.slice(start).trim());
  return out.filter(Boolean);
}

// Cover line: the first bullet, or its first clause, if it fits two lines (~64 characters).
// Leads with the action when it starts with the title ("Russell Brand was..." → "was...").
// Returns { hook, cut } where cut means words had to be chopped (the post then waits for review).
const HOOK_MAX = 64;
function deriveHook(candidates, title, description) {
  const tidy = t => { let s = plain(t).trim(); if (s.startsWith(title + ' ')) s = s.slice(title.length + 1); return s; };
  const end = t => (/[.!?]["”')]*$/.test(t) ? t : t.replace(/[\s,;:—–-]+$/, '') + '.');
  for (const c of candidates) {
    const s = tidy(c);
    if (s.length <= HOOK_MAX) return { hook: end(s), cut: false };
    const clause = s.split(/, | — | – |; /)[0];
    if (clause.length >= 25 && clause.length <= HOOK_MAX && clause.length < s.length) return { hook: end(clause), cut: false };
  }
  // Never ship a sentence chopped mid-way. Fall back to Wikipedia's short
  // description ("American political advisor (born 1985)" → "American political advisor.").
  const desc = (description || '').replace(/\s*\([^)]*\)\s*/g, ' ').trim();
  if (desc && desc.length <= HOOK_MAX) return { hook: end(desc.charAt(0).toUpperCase() + desc.slice(1)), cut: false };
  return { hook: trimTo(tidy(candidates[0] || title), HOOK_MAX), cut: true };
}

// Dark, political or sexual picks go to Publer as drafts for review (social/RULES.md).
const FLAG_RE = new RegExp('\\b(' + [
  'death', 'deaths', 'dead', 'die', 'died', 'dies', 'dying', 'kill', 'killed', 'killing', 'killings', 'murder\\w*', 'rape\\w*', 'rapist\\w*',
  'assault\\w*', 'shooting\\w*', 'shot dead', 'stabb\\w*', 'suicide', 'massacre\\w*', 'terror\\w*', 'genocide', 'abuse\\w*', 'assassinat\\w*',
  'homicide', 'manslaughter', 'overdose', 'bombing\\w*', 'hostage\\w*', 'convicted', 'war', 'crash\\w*',
  'election\\w*', 'elected', 'senat\\w*', 'politician', 'president\\w*', 'congress\\w*', 'parliament\\w*', 'prime minister', 'governor\\w*',
  'campaign\\w*', 'republican\\w*', 'democrat\\w*', 'trump', 'biden',
  'sex', 'sexual\\w*', 'porn\\w*', 'nude', 'naked', 'erotic\\w*',
].join('|') + ')\\b', 'i');

// Copy rules that make a post need a human look instead of going out on its own.
function lintCopy(texts) {
  const all = texts.join('\n');
  const r = [];
  if (/yesterday/i.test(all)) r.push('copy says "yesterday"');
  if (/(^|\s)#\w/.test(all)) r.push('copy has a hashtag');
  if (/\p{Extended_Pictographic}/u.test(all)) r.push('copy has an emoji');
  if (/\[\.\.\.\]|…/.test(all)) r.push('copy shows a cut mark');
  return r;
}

// ---------- Wikipedia / Commons images ----------
async function getJson(url) {
  const res = await fetch(url, { headers: { 'User-Agent': UA } });
  if (!res.ok) throw new Error(`${res.status} for ${url}`);
  return res.json();
}
const api = params => getJson('https://en.wikipedia.org/w/api.php?' + new URLSearchParams({ format: 'json', formatversion: '2', ...params }));

async function pageImageName(article) {
  try {
    const j = await api({ action: 'query', prop: 'pageimages', piprop: 'name', pilicense: 'any', redirects: '1', titles: article.title.replace(/_/g, ' ') });
    const p = j.query && j.query.pages && j.query.pages[0];
    if (p && p.pageimage) return p.pageimage;
  } catch (e) { warn(`Page image lookup failed: ${e.message}`); }
  // Fall back to the thumbnail saved by the build.
  const m = (article.thumbnail || '').split('?')[0].match(/\/wikipedia\/(?:commons|en)\/(?:thumb\/)?[0-9a-f]\/[0-9a-f]{2}\/([^/]+)/);
  return m ? decodeURIComponent(m[1]) : null;
}

const OK_MIME = /^image\/(jpeg|png|gif|webp|svg\+xml)$/;
async function fileInfo(name) {
  const title = name.startsWith('File:') ? name : 'File:' + name;
  const j = await api({ action: 'query', prop: 'imageinfo', iiprop: 'url|extmetadata|mime|size', iiurlwidth: '1280', titles: title,
    iiextmetadatafilter: 'Artist|LicenseShortName|NonFree|Credit' });
  const p = j.query.pages[0];
  const ii = p && p.imageinfo && p.imageinfo[0];
  if (!ii) throw new Error(`No image info for ${title}`);
  const md = ii.extmetadata || {};
  const license = stripTags(md.LicenseShortName && md.LicenseShortName.value);
  const nonFree = (md.NonFree && /true/i.test(md.NonFree.value)) || /fair use|non-free/i.test(license);
  const artist = stripTags(md.Artist && md.Artist.value).split(/\n/)[0].replace(/,?\s*photographer$/i, '').trim();
  const small = ii.width <= 1400 && OK_MIME.test(ii.mime);
  return { title: p.title, url: small ? ii.url : (ii.thumburl || ii.url), repo: p.imagerepository, nonFree, artist, license };
}

async function download(url, dir, base) {
  const ext = (url.split('?')[0].match(/\.(jpe?g|png|gif|webp|svg)$/i) || [, 'jpg'])[1].toLowerCase();
  const dest = path.join(dir, `${base}.${ext}`);
  const res = await fetch(url, { headers: { 'User-Agent': UA } });
  if (!res.ok) throw new Error(`${res.status} downloading ${url}`);
  fs.writeFileSync(dest, Buffer.from(await res.arrayBuffer()));
  return dest;
}

const commonsCredit = (artist, license) => `Image: ${artist || 'Unknown author'}, ${license || 'see Wikimedia Commons'}, via Wikimedia Commons`;

// ---------- rendering ----------
function chromeBin() {
  if (process.env.CHROME) return process.env.CHROME;
  if (process.platform === 'darwin') return '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
  return 'google-chrome';
}

// Write the page, screenshot it, and read back the fit report the page leaves on <html data-fit>.
function renderSlide(body, htmlPath, pngPath) {
  fs.writeFileSync(htmlPath, S.page(body));
  const args = ['--headless=new', '--force-device-scale-factor=1', '--window-size=1080,1440', '--virtual-time-budget=6000',
    '--hide-scrollbars', '--no-first-run', '--no-default-browser-check', `--screenshot=${pngPath}`, '--dump-dom',
    'file://' + htmlPath.split(path.sep).map(encodeURIComponent).join('/')];
  if (process.env.CI) args.unshift('--no-sandbox'); // only our own local pages are loaded
  for (let attempt = 1; attempt <= 3; attempt++) {
    const r = spawnSync(chromeBin(), args, { encoding: 'utf8', maxBuffer: 64 << 20, timeout: 90e3 });
    if (r.error) throw new Error(`Chrome failed to start (${chromeBin()}): ${r.error.message}`);
    const m = (r.stdout || '').match(/data-fit="([^"]*)"/);
    if (m && fs.existsSync(pngPath)) {
      const fit = JSON.parse(decodeEntities(m[1]));
      if (fit.fonts || attempt === 3) {
        if (!fit.fonts) fit.issues.push('web fonts did not load');
        return fit;
      }
    }
    console.log(`  render attempt ${attempt} incomplete, retrying ${path.basename(pngPath)}`);
  }
  throw new Error(`Could not render ${htmlPath}`);
}

// ---------- the trending (WikiPop) carousel ----------
async function buildTrending(article, why, dir, tmp) {
  const title = displayTitle(article.title);
  const w = why && why.show !== false && Array.isArray(why.bullets) && why.bullets.length ? why : null;
  const reasons = [];

  // Bullets: why.json's, or three short facts from the extract (no heading, never "we're not sure why").
  let bullets = limitHighlights(w ? w.bullets.map(mdToMarked).slice(0, 4) : extractSentences(article.extract).slice(0, 3));
  const heading = w ? 'What happened' : null;
  const first = w ? plain(mdToMarked(w.bullets[0])) : (extractSentences(article.extract)[0] || article.description || '');
  // Only the first bullet: it's the story. A later bullet can be a side note ("He was cleared on...").
  const derived = deriveHook(w ? [mdToMarked(w.bullets[0])] : extractSentences(article.extract).slice(0, 1), title, article.description);
  let hook = why && why.hook ? why.hook : derived.hook;
  if (!(why && why.hook) && derived.cut) reasons.push('cover line had to be cut mid-sentence');

  // Cover photo: the article's main image.
  let image = null, credit = '', imgPos = why && why.imgPos;
  const name = await pageImageName(article);
  if (name) {
    try {
      const info = await fileInfo(name);
      image = await download(info.url, tmp, 'trending');
      const poster = info.nonFree && (/poster/i.test(info.title) || /\b(film|series|album|show)\b/i.test(article.description || ''));
      credit = info.nonFree ? (poster ? 'Poster via Wikipedia' : 'Image via Wikipedia')
        : info.repo === 'local' ? `Image: ${info.artist || 'Unknown author'}, ${info.license}, via Wikipedia`
        : commonsCredit(info.artist, info.license);
      if (!imgPos) imgPos = poster ? '50% 100%' : '50% 20%'; // posters: keep the title block in view
    } catch (e) { warn(`Cover image failed: ${e.message}`); }
  }
  if (!image) reasons.push('no usable image (pick a related Commons photo)');

  // Render, trimming copy until it fits (trim words, never shrink the font).
  const slides = [];
  let fit;
  for (let i = 0; i < 6; i++) {
    fit = renderSlide(S.trendingCover({ image, imgPos, views: viewsShort(article.views) + (article.provisional ? "+" : ""), title, hook }),
      path.join(dir, 'trending-1.html'), path.join(dir, 'trending-1.png'));
    if (!fit.issues.some(x => /hook|photo/.test(x)) || plain(hook).length < 30) break;
    hook = trimTo(hook, Math.floor(plain(hook).length * 0.8));
    if (!reasons.includes('cover line had to be cut mid-sentence')) reasons.push('cover line had to be cut mid-sentence');
  }
  if (fit.issues.length) reasons.push(`cover: ${fit.issues.join(', ')}`);
  slides.push({ png: path.join(dir, 'trending-1.png'), alt: `${title}: ${plain(hook)}`, fit });

  for (let i = 0; i < 10; i++) {
    fit = renderSlide(S.trendingBullets({ heading, bullets }), path.join(dir, 'trending-2.html'), path.join(dir, 'trending-2.png'));
    if (!fit.issues.length) break;
    // Too long: first drop a 4th bullet (one without a highlight, so the highlight survives)...
    if (bullets.length > 3) {
      let j = bullets.length - 1;
      while (j > 0 && /\[\[/.test(bullets[j])) j--;
      bullets.splice(j > 0 ? j : bullets.length - 1, 1);
      continue;
    }
    // ...then cut the longest bullet back. That can leave an odd sentence, so a person checks it.
    const longest = bullets.reduce((a, b, j) => (plain(b).length > plain(bullets[a]).length ? j : a), 0);
    const len = plain(bullets[longest]).length;
    if (len < 50) break;
    bullets[longest] = trimTo(bullets[longest], Math.floor(len * 0.85));
    if (!reasons.includes('a bullet had to be cut mid-sentence')) reasons.push('a bullet had to be cut mid-sentence');
  }
  if (fit.issues.length) reasons.push(`bullets: ${fit.issues.join(', ')}`);
  slides.push({ png: path.join(dir, 'trending-2.png'), alt: (heading ? heading + ': ' : '') + bullets.map(plain).join(' '), fit });

  const caption = `${why && why.caption ? why.caption.trim() : `${title}: ${first}`}\n\n${article.provisional ? 'More than' : 'About'} ${viewsLong(article.views)} people looked it up on Wikipedia.\n\nThe rest of the top list: link in bio.${credit ? `\n\n${credit}` : ''}`;

  // Review flags → draft.
  const copy = [caption, hook, ...bullets];
  reasons.push(...lintCopy(copy));
  if (why && why.hard === true) reasons.push('marked hard in why.json');
  else if (!(why && why.hard === false)) {
    const hit = [article.extract, article.description, title, ...bullets.map(plain)].join(' ').match(FLAG_RE);
    if (hit) reasons.push(`sensitive topic ("${hit[0]}")`);
  }
  return { kind: 'trending', title, caption, hook, bullets: bullets.map(plain), slides, reasons, hasWhy: !!w };
}

// ---------- the obscure carousel ----------
async function obscureImage(im, tmp, base) {
  if (!im) return null;
  const file = typeof im === 'string' ? im : im.file;
  const info = await fileInfo(file);
  const local = await download(info.url, tmp, base);
  const artist = (typeof im === 'object' && im.artist) || info.artist;
  const license = (typeof im === 'object' && im.license) || info.license;
  return { local, credit: commonsCredit(artist, license) };
}

async function buildObscure(entryTitle, cur, dir, tmp) {
  const title = entryTitle;
  const reasons = [], errors = [];
  const main = await obscureImage(cur.image, tmp, 'obscure-1');
  const credits = main ? [main.credit] : [];
  const specs = [
    { body: S.obscureFirst({ title, text: cur.slide1.text, image: main && main.local, imgPos: cur.imgPos, imgZoom: cur.imgZoom }),
      alt: `${title}: ${plain(cur.slide1.text)}` },
  ];
  for (const s of [cur.slide2, cur.slide3].filter(Boolean)) {
    specs.push({ body: S.obscureSection({ title, heading: s.heading, paras: s.paras || [] }), alt: `${s.heading}: ${(s.paras || []).map(plain).join(' ')}` });
  }
  for (const [i, s] of (cur.extraSlides || []).entries()) {
    const im = await obscureImage(s.image, tmp, `obscure-x${i + 1}`);
    if (im && !credits.includes(im.credit)) credits.push(im.credit);
    specs.push({ body: S.obscureSection({ title, heading: s.heading, paras: s.paras || [], image: im && im.local, imgPos: s.imgPos, imgZoom: s.imgZoom }),
      alt: `${s.heading}: ${(s.paras || []).map(plain).join(' ')}` });
  }
  const slides = specs.slice(0, 10).map((sp, i) => {
    const png = path.join(dir, `obscure-${i + 1}.png`);
    const fit = renderSlide(sp.body, path.join(dir, `obscure-${i + 1}.html`), png);
    if (fit.issues.length) errors.push(`slide ${i + 1}: ${fit.issues.join(', ')}`);
    return { png, alt: sp.alt, fit };
  });
  const caption = `${cur.caption.trim()}${credits.map(c => `\n\n${c}`).join('')}`;
  const allText = [caption, cur.slide1.text, ...[cur.slide2, cur.slide3, ...(cur.extraSlides || [])].filter(Boolean).flatMap(s => [s.heading, ...(s.paras || [])])];
  reasons.push(...lintCopy(allText));
  if (cur.hard) reasons.push('marked hard in obscure-slides.json');
  // Slide 1 plus at least one more slide (a list entry can be slide 1 + extra slides only).
  if (!cur.slide1 || !cur.slide1.text) errors.push('curated entry is missing slide1');
  if (![cur.slide2, cur.slide3, ...(cur.extraSlides || [])].some(Boolean)) errors.push('curated entry needs at least one slide after slide 1');
  return { kind: 'obscure', title, caption, slides, reasons, errors };
}

// ---------- scheduling ----------
function tzOffsetMin(date) {
  const s = new Intl.DateTimeFormat('en-US', { timeZone: TZ, timeZoneName: 'longOffset' }).formatToParts(date).find(p => p.type === 'timeZoneName').value;
  const m = s.match(/GMT([+-])(\d{2}):(\d{2})/);
  return m ? (m[1] === '-' ? -1 : 1) * (+m[2] * 60 + +m[3]) : 0;
}
function pacificTime(dateStr, hh, mm) {
  const [y, mo, d] = dateStr.split('-').map(Number);
  let t = Date.UTC(y, mo - 1, d, hh, mm);
  for (let i = 0; i < 2; i++) t = Date.UTC(y, mo - 1, d, hh, mm) - tzOffsetMin(new Date(t)) * 60e3;
  return new Date(t);
}
function isoPacific(date) {
  const off = tzOffsetMin(date);
  const local = new Date(date.getTime() + off * 60e3).toISOString().slice(0, 19);
  const a = Math.abs(off);
  return `${local}${off < 0 ? '-' : '+'}${String(Math.floor(a / 60)).padStart(2, '0')}:${String(a % 60).padStart(2, '0')}`;
}
function slots(day, now = new Date()) {
  const planned = pacificTime(day, ...FIRST_SLOT);
  const soonest = new Date(Math.ceil((now.getTime() + 10 * 60e3) / 60e3) * 60e3);
  const first = planned > soonest ? planned : soonest;
  return [first, new Date(first.getTime() + GAP_MS)];
}

// ---------- Publer ----------
const KEY = process.env.PUBLER_API_KEY;
async function publer(method, p, body) {
  const headers = { Authorization: `Bearer-API ${KEY}`, 'Publer-Workspace-Id': WORKSPACE_ID, Accept: 'application/json' };
  let payload = body;
  if (body && !(body instanceof FormData)) { headers['Content-Type'] = 'application/json'; payload = JSON.stringify(body); }
  const res = await fetch(PUBLER + p, { method, headers, body: payload });
  const text = await res.text();
  let j; try { j = JSON.parse(text); } catch { j = { raw: text }; }
  if (!res.ok) throw new Error(`Publer ${method} ${p} → ${res.status}: ${text.slice(0, 300)}`);
  return j;
}
const sleep = ms => new Promise(r => setTimeout(r, ms));
const norm = s => String(s || '').replace(/\s+/g, ' ').trim();
const sameText = (a, b) => norm(a).slice(0, 120) === norm(b).slice(0, 120);

async function listPosts(state, day) {
  const posts = [];
  for (let page = 0; page < 5; page++) {
    const q = new URLSearchParams({ state, page: String(page), from: addDays(day, -1), to: addDays(day, 2) });
    q.append('account_ids[]', IG_ACCOUNT_ID);
    const j = await publer('GET', `/posts?${q}`);
    posts.push(...(j.posts || []));
    if (!j.total_pages || page + 1 >= j.total_pages) break;
  }
  return posts;
}

async function upload(png) {
  const fd = new FormData();
  fd.append('file', new Blob([fs.readFileSync(png)], { type: 'image/png' }), path.basename(png));
  const j = await publer('POST', '/media', fd);
  if (!j.id || !j.path) throw new Error(`Upload of ${path.basename(png)} returned no id/path: ${JSON.stringify(j).slice(0, 200)}`);
  return j;
}

function payloadFor(post, media) {
  const account = { id: IG_ACCOUNT_ID, scheduled_at: post.scheduledAt };
  return { bulk: { state: post.state, posts: [{
    // Several photos in one "photo" post make an Instagram carousel ("carousel" errors in Publer).
    networks: { instagram: { type: 'photo', text: post.caption, media: media.map((m, i) => ({ id: m.id, path: m.path, type: 'photo', alt_text: post.slides[i].alt.slice(0, 500) })) } },
    accounts: [account],
  }] } };
}

async function waitForJob(id) {
  for (let i = 0; i < 60; i++) {
    const j = await publer('GET', `/job_status/${id}`);
    const st = j.status || (j.data && j.data.status);
    if (st && st !== 'working' && st !== 'pending') {
      const failures = (j.payload && j.payload.failures) || (j.data && j.data.result && j.data.result.payload && j.data.result.payload.failures) || {};
      if (/fail|error/i.test(st) || Object.keys(failures).length) throw new Error(`Publer job ${id} ${st}: ${JSON.stringify(j).slice(0, 400)}`);
      return j;
    }
    await sleep(3000);
  }
  throw new Error(`Publer job ${id} still working after 3 minutes`);
}

async function publish(post, day) {
  const label = `${post.kind} "${post.title}"`;
  const existing = await listPosts('all', day);
  const dup = existing.find(p => sameText(p.text, post.caption) && !/failed|deleted/.test(p.state || ''));
  if (dup) { console.log(`  ${label}: already in Publer (${dup.state} ${dup.scheduled_at || ''}), skipping.`); return; }
  // Publer needs a minute between posts on one account.
  const taken = existing.filter(p => p.scheduled_at).map(p => Date.parse(p.scheduled_at));
  let t = Date.parse(post.scheduledAt);
  while (taken.some(x => Math.abs(x - t) < 90e3)) t += 2 * 60e3;
  post.scheduledAt = isoPacific(new Date(t));

  const media = [];
  for (const s of post.slides) { media.push(await upload(s.png)); }
  const res = await publer('POST', '/posts/schedule', payloadFor(post, media));
  if (!res.job_id) throw new Error(`No job_id for ${label}: ${JSON.stringify(res).slice(0, 300)}`);
  await waitForJob(res.job_id);

  const state = post.state === 'draft' ? 'draft' : 'scheduled';
  for (let i = 0; i < 6; i++) {
    const found = (await listPosts(state, day)).find(p => sameText(p.text, post.caption));
    if (found) { console.log(`  ${label}: ${state} for ${found.scheduled_at || post.scheduledAt} (post ${found.id}).`); return; }
    await sleep(5000);
  }
  throw new Error(`${label} was sent but isn't in Publer's ${state} posts`);
}

// ---------- main ----------
async function main() {
  const articles = readJson(path.join(DATA, 'articles.json'), []);
  const why = readJson(path.join(DATA, 'why.json'), {});
  const entries = readJson(path.join(DATA, 'featured-entries.json'), []);
  const fstate = readJson(path.join(DATA, 'featured-index.json'), { index: 0 });
  const curated = readJson(path.join(DATA, 'obscure-slides.json'), {});

  // The posting day is the day the pick is on the site: the article's data date + 1.
  const latest = articles[articles.length - 1];
  const day = DATE_ARG || addDays(latest.date, 1);
  const article = articles.find(a => a.date === addDays(day, -1));
  if (!article) throw new Error(`No article for ${day} (looking for data date ${addDays(day, -1)})`);
  // Only post the pick for today (UTC): a retry run before the new day's data
  // lands would otherwise re-post yesterday's pick.
  if (MODE === 'post' && !DATE_ARG && day !== new Date().toISOString().slice(0, 10)) {
    console.log(`Newest data is for ${day}, not today; today's isn't in yet. Nothing to post.`);
    return;
  }

  const dir = path.join(OUT_ROOT, day);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wikipop-social-'));
  console.log(`Instagram for ${day}: rendering into ${path.relative(ROOT, dir)}`);

  const [t1, t2] = slots(day);
  const posts = [];

  // 1) Trending.
  const trending = await buildTrending(article, why[article.date], dir, tmp);
  trending.state = trending.reasons.length ? 'draft' : 'scheduled';
  trending.scheduledAt = isoPacific(t1);
  posts.push(trending);

  // 2) Obscure: the entry the build pinned to that day's article (same one as the site and email);
  //    if it isn't pinned, the queue's pick (the build advances the index once a day).
  const pinned = article.obscure && entries.find(e => e.url === article.obscure);
  const idx = ((fstate.index + daysBetween(fstate.lastAdvanced || day, day)) % entries.length + entries.length) % entries.length;
  const oTitle = OBSCURE_ARG || (pinned ? pinned.title : entries[idx] && entries[idx].title);
  const cur = oTitle && curated[oTitle];
  let obscure = null;
  if (!cur) {
    warn(`No curated slides in data/obscure-slides.json for obscure pick "${oTitle}"; skipping the obscure post.`);
  } else {
    obscure = await buildObscure(oTitle, cur, dir, tmp);
    obscure.state = obscure.reasons.length ? 'draft' : 'scheduled';
    obscure.scheduledAt = isoPacific(t2);
    if (obscure.errors.length) fail(`Obscure "${oTitle}" won't post: ${obscure.errors.join('; ')}`);
    posts.push(obscure);
  }

  const summary = {
    day, generatedAt: new Date().toISOString(),
    posts: posts.map(p => ({ kind: p.kind, title: p.title, state: p.state, reasons: p.reasons, errors: p.errors || [], scheduledAt: p.scheduledAt,
      caption: p.caption, slides: p.slides.map(s => ({ png: path.relative(ROOT, s.png), alt: s.alt, fit: s.fit })) })),
    obscureSkipped: cur ? null : `no curated slides for "${oTitle}"`,
  };
  fs.writeFileSync(path.join(dir, 'post.json'), JSON.stringify(summary, null, 2) + '\n');
  fs.rmSync(tmp, { recursive: true, force: true });
  for (const p of posts) {
    console.log(`\n[${p.kind}] ${p.title} → ${p.state} at ${p.scheduledAt}${p.reasons.length ? ` (review: ${p.reasons.join('; ')})` : ''}`);
    p.slides.forEach(s => console.log(`  ${path.relative(ROOT, s.png)}  ${s.fit.issues.length ? 'ISSUES: ' + s.fit.issues.join(', ') : 'fits'}`));
    console.log('  caption: ' + p.caption.replace(/\n/g, '\n           '));
  }
  if (MODE !== 'post') return;

  const toSend = posts.filter(p => !(p.errors && p.errors.length));
  if (DRY) {
    for (const p of toSend) console.log(`\nDRY RUN ${p.kind} payload:\n` + JSON.stringify(payloadFor(p, p.slides.map((_, i) => ({ id: `<media ${i + 1}>`, path: `<path ${i + 1}>` }))), null, 2));
    return;
  }
  if (!KEY) throw new Error('PUBLER_API_KEY is not set');
  let failed = posts.length !== toSend.length;
  for (const p of toSend) {
    try { await publish(p, day); } catch (e) { failed = true; fail(e.message); }
  }
  if (failed) process.exitCode = 1;
}

main().catch(e => { fail(e.stack || e.message); process.exitCode = 1; });
