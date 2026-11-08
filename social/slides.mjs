// Markup for the Instagram slides. Matches the approved mockups class for class; the look lives in
// social/slides.css. Every slide is a 1080x1440 page that headless Chrome screenshots.
//
// Text helpers take plain text. [[like this]] marks a highlight. Everything else is escaped,
// so nothing from the data can sneak in a link or other markup (posts can't be tapped).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CSS = fs.readFileSync(path.join(HERE, 'slides.css'), 'utf8');

// Bangers + Instrument Sans are the brand fonts. Gelasio only kicks in on Linux (see slides.css).
const FONTS = 'https://fonts.googleapis.com/css2?family=Bangers&family=Gelasio:ital,wght@0,400;0,700;1,400&family=Instrument+Sans:ital,wght@0,400;0,500;0,600;0,700;1,400&display=swap';

export const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// Plain text with [[highlights]] → safe HTML.
export const hl = s => esc(s).replace(/\[\[(.+?)\]\]/g, '<span class="hl">$1</span>');

// Bold the article title where the lead sentence starts with it, like Wikipedia does.
function boldTitle(html, title) {
  const t = esc(title.replace(/ \(.*\)$/, ''));
  const i = html.indexOf(t);
  return i >= 0 && i < 6 ? html.slice(0, i) + `<b>${t}</b>` + html.slice(i + t.length) : html;
}

const imgSrc = file => 'file://' + file.split(path.sep).map(encodeURIComponent).join('/');

function imgTag(file, pos, zoom) {
  if (!file) return '';
  const p = pos || '50% 50%';
  if (zoom && zoom > 1) {
    return `<div class="pfo"><img src="${imgSrc(file)}" alt="" style="object-position:${esc(p)};transform:scale(${Number(zoom)});transform-origin:${esc(p)}"></div>`;
  }
  return `<img src="${imgSrc(file)}" alt="" style="object-position:${esc(p)}">`;
}

const STICKER = '<div class="nv nv3 t3"><span><i class="w">Wiki</i><i class="p">Pop!</i></span><span><i class="o">Obscure</i></span></div>';
const LOGO = '<div class="mini5"><span class="logo">Wiki<span>Pop!</span></span></div>';

// ---------- Trending (WikiPop) carousel ----------

// Slide 1: photo above the black box, kicker + big title + one-line hook.
export function trendingCover({ image, imgPos, views, title, hook }) {
  const nm = esc(title).replace(/-/g, '&#8209;'); // keep hyphenated names on one line
  const pf = image ? `<img src="${imgSrc(image)}" alt="" style="object-position:${esc(imgPos || '50% 20%')}">` : '';
  return `<div class="cv r34 dots-y c5 hc"><div class="card5 ph"><div class="pf">${pf}</div><div class="cap5"><div class="kk"><em>Trending</em> on Wikipedia · ${esc(views)} views</div><div class="nm">${nm}</div><p class="ln">${hl(hook)}</p></div></div>${LOGO}</div>`;
}

// Slide 2: "What happened" + 3-4 bullets. heading: null leaves it off (facts from the extract).
export function trendingBullets({ heading, bullets }) {
  const h = heading ? `<h4 class="t" style="margin-bottom:4.5cqw">${esc(heading)}</h4>` : '';
  const li = bullets.map(b => `<li><span>${hl(b)}</span></li>`).join('\n');
  return `<div class="cv r34 dots-y f5"><div class="card5">${h}<ul class="wb wb-1 sm">\n${li}</ul></div></div>`;
}

// ---------- Obscure carousel ----------

// Slide 1: photo on top, Wikipedia-style title and lead, sticker bottom right.
export function obscureFirst({ title, text, image, imgPos, imgZoom }) {
  const lead = boldTitle(hl(text), title);
  if (!image) {
    return `<div class="cv r34 fp ob8 dots-c"><div class="obc txt"><div class="tx"><h4 class="t big">${esc(title)}</h4><div class="f">From Wikipedia, the free encyclopedia</div><p class="big">${lead}</p></div></div>${STICKER}</div>`;
  }
  return `<div class="cv r34 fp ob8 dots-c"><div class="obc">${imgTag(image, imgPos, imgZoom)}<div class="tx"><h4 class="t">${esc(title)}</h4><div class="f">From Wikipedia, the free encyclopedia</div><p>${lead}</p></div></div>${STICKER}</div>`;
}

// Later slides: article title small and grey, section heading, paragraphs. Optional photo on top.
export function obscureSection({ title, heading, paras, image, imgPos, imgZoom }) {
  const body = `<div class="tx"><div class="of">${esc(title)}</div><h4 class="sec">${esc(heading)}</h4>${paras.map(p => `<p>${hl(p)}</p>`).join('')}</div>`;
  if (image) return `<div class="cv r34 fp ob8 dots-c"><div class="obc">${imgTag(image, imgPos || '50% 25%', imgZoom)}${body}</div></div>`;
  return `<div class="cv r34 fp ob8 dots-c"><div class="obc txt">${body}</div></div>`;
}

// ---------- Page ----------

// After fonts load, measure whether the text fits and leave the result on <html data-fit="...">
// for the render script to read (Chrome's --dump-dom). The screenshot itself is unchanged.
const FIT_SCRIPT = `<script>
(function () {
  function textRects(root) {
    var out = [], w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT), n;
    while ((n = w.nextNode())) {
      if (!n.nodeValue.trim()) continue;
      var r = document.createRange(); r.selectNodeContents(n);
      var rs = r.getClientRects();
      for (var i = 0; i < rs.length; i++) if (rs[i].width > 0) out.push(rs[i]);
    }
    return out;
  }
  function px(el, prop) { return parseFloat(getComputedStyle(el)[prop]) || 0; }
  function hit(a, b) { return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top; }
  function measure() {
    // Fonts: the Google Fonts stylesheet registered faces, and none of the ones in use failed.
    var faces = Array.from(document.fonts);
    var res = { fonts: faces.length > 0 && !faces.some(function (f) { return f.status === 'error'; }), issues: [] };
    var imgs = document.images;
    for (var i = 0; i < imgs.length; i++) if (!imgs[i].complete || !imgs[i].naturalWidth) res.issues.push('image did not load');
    var cover = document.querySelector('.card5.ph');
    if (cover) {
      var pf = cover.querySelector('.pf'), nm = cover.querySelector('.nm'), ln = cover.querySelector('.ln');
      res.photoShare = pf.getBoundingClientRect().height / cover.getBoundingClientRect().height;
      res.hookLines = Math.round(ln.getBoundingClientRect().height / px(ln, 'lineHeight'));
      res.titleLines = Math.round(nm.getBoundingClientRect().height / px(nm, 'lineHeight'));
      if (nm.scrollWidth > nm.clientWidth + 1) res.issues.push('title too wide');
      if (res.hookLines > 2) res.issues.push('hook over 2 lines');
      if (res.photoShare < 0.45) res.issues.push('photo squeezed to ' + Math.round(res.photoShare * 100) + '%');
    } else {
      var box = document.querySelector('.card5, .obc');
      var pad = box.querySelector('.tx') || box;
      var b = box.getBoundingClientRect();
      var bottom = b.bottom - px(box, 'borderBottomWidth') - px(pad, 'paddingBottom') + 1;
      var right = b.right - px(box, 'borderRightWidth') + 1;
      var rects = textRects(box), max = 0;
      var nv = document.querySelector('.nv'), nvr = nv && nv.getBoundingClientRect();
      for (var j = 0; j < rects.length; j++) {
        max = Math.max(max, rects[j].bottom);
        if (rects[j].right > right) res.issues.push('text too wide');
        if (nvr && hit(rects[j], nvr)) res.issues.push('text under the sticker');
      }
      res.spare = Math.round(bottom - max);
      if (max > bottom) res.issues.push('text overflows the card by ' + Math.round(max - bottom) + 'px');
    }
    res.issues = res.issues.filter(function (x, i, a) { return a.indexOf(x) === i; });
    document.documentElement.setAttribute('data-fit', JSON.stringify(res));
  }
  document.fonts.ready.then(function () { setTimeout(measure, 50); });
})();
</script>`;

export function page(body) {
  return `<!doctype html><html><head><meta charset="utf-8">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="${FONTS}" rel="stylesheet">
<style>${CSS}</style></head><body>${body}${FIT_SCRIPT}</body></html>`;
}
