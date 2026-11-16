/* Ultra Pro Reader — background service worker.
   Turns the reader into a versatile tool: it can grab any web page (or just the
   selected text on any site) and turn it into a book that is read aloud.
   The extraction engine is a port of the "Read Aloud" extension's article
   parser (MIT, github.com/read-aloud) — DOM block walking with statistical
   boilerplate trimming, so it works smoothly on nearly every website,
   including JS-rendered readers like wtr-lab. */

const READER_URL = chrome.runtime.getURL("reader.html");

/* ================= Extraction engine (runs inside the web page) ================ */
async function uprExtract(){
  const sel = String(window.getSelection() || "").trim();
  const base = { kind: "page", title: document.title || "Untitled page", url: location.href, text: "", next: "" };
  if(sel.length > 60){ base.kind = "selection"; base.text = sel; return base; }

  /* Sites like "My EPUB Collection" (epub.js readers) keep the real content in
     .epub files that the page fetches itself. Discover those so the background
     can hand them to the reader as proper book downloads. */
  const epubUrls = (() => {
    const out = [], seen = new Set();
    const add = p => { try{ const u = new URL(p, location.href).href; if(/^https?:/i.test(u) && !seen.has(u)){ seen.add(u); out.push(u); } }catch(e){} };
    try{
      document.querySelectorAll("a[href]").forEach(a => {
        const h = a.getAttribute("href") || "";
        if(/\.epub([?#]|$)/i.test(h)) add(h);
      });
      document.querySelectorAll("script:not([src])").forEach(s => {
        const t = s.textContent || "";
        const re = /["']([^"'\n]{2,200}?\.epub)["']/gi;
        let m;
        while((m = re.exec(t))) add(m[1]);
      });
    }catch(e){}
    return out.slice(0, 12);
  })();

  /* Known reader containers first — fast and precise on popular novel sites. */
  const visible = el => !!(el.offsetParent || el.offsetHeight || el.getClientRects().length);
  const textOf = el => { try{ return (el.innerText || "").trim(); }catch(e){ return ""; } };
  const SKIP_TAGS = new Set(["SCRIPT","STYLE","NOSCRIPT","TEMPLATE","EMBED","OBJECT","SVG","CANVAS","AUDIO","VIDEO","SELECT","TEXTAREA","BUTTON","DIALOG","INPUT","LABEL","FORM","MENU","FIGURE","IMG","HEADER","NAV","FOOTER","ASIDE","LINK","META"]);
  const HINT_SELECTORS = [
    [/wtr-lab\.com$/i, ".chapter-body, [data-chapter-id]"],
    [/royalroad\.com$/i, ".chapter-content"],
    [/wattpad\.com$/i, "pre_part, .part-content, #chapters"],
    [/webnovel\.com$/i, ".cha-paragraph"],
    [/archiveofourown\.org$/i, "#workskin, .userstuff"],
    [/fanfiction\.net$/i, "#storytext"],
    [/lightnovel(cave|world|pub|str)\./i, ".chapter-content, #chapter-container"],
    [/scribblehub\.com$/i, "#primary .chp_name, .post-entry"],
    [/novelupdates\.com$/i, ".chapter-content"],
    [/medium\.com$/i, "article"],
    [/substack\.com$/i, "article"],
    [/readlightnovel/i, "#chapter-content, .cha-words"],
    [/novel(full|bin|spread)\./i, "#chaptercontent, .chapter-content"],
    [/mANGA[Bb]uddy|novelcool/i, "#chapter-container"]
  ];
  const host = location.hostname;
  function hintSelector(){
    for(const [re, selCss] of HINT_SELECTORS){ if(re.test(host)) return selCss.split(",")[0].trim(); }
    return null;
  }
  /* SPA loading states ("Opening…", spinners) — grabbing these as "the chapter"
     is what produced junk books. Skeleton text is treated as not-yet-loaded. */
  const PLACEHOLDER_RE = /^\s*(opening|loading|loading…|please wait|just a moment|initializing)\b/i;
  function isSkeleton(t){
    const s = String(t || "").replace(/\s+/g, " ").trim();
    if(s.length < 250) return true;   /* real chapters are far longer */
    return PLACEHOLDER_RE.test(s) && s.length < 600;
  }
  let hintText = "";
  for(const [re, selCss] of HINT_SELECTORS){
    if(re.test(host)){
      const el = document.querySelector(selCss);
      if(el && visible(el)){
        hintText = textOf(el);
        if(hintText.length >= 400) break;
      }
    }
  }

  function findTextBlocks(threshold){
    const blocks = [];
    const isTextNode = n => n.nodeType === 3 && n.nodeValue.trim().length >= 3;
    const hasTextNodes = el => textOf(el).length >= threshold && Array.from(el.childNodes).some(isTextNode);
    const hasParagraphs = el => Array.from(el.childNodes).some(n => n.nodeType === 1 && n.tagName === "P" && visible(n) && textOf(n).length >= threshold);
    function walk(el){
      if(el.tagName === "IFRAME"){ try{ walk(el.contentDocument.body); }catch(e){} return; }
      if(el.tagName === "DL"){ blocks.push(el); return; }
      if(el.tagName === "UL" || el.tagName === "OL"){
        const items = Array.from(el.children);
        if(items.some(hasTextNodes)) blocks.push(el);
        else if(items.some(hasParagraphs)) { el.dataset.readAloudMulti = "1"; blocks.push(el); }
        return;
      }
      if(el.tagName === "TBODY"){
        const rows = Array.from(el.children);
        if(rows.length > 3){ el.dataset.readAloudMulti = "1"; blocks.push(el); return; }
      }
      if(hasTextNodes(el)){ blocks.push(el); return; }
      if(hasParagraphs(el)){ el.dataset.readAloudMulti = "1"; blocks.push(el); return; }
      for(const c of el.children){ if(!SKIP_TAGS.has(c.tagName)) walk(c); }
    }
    if(document.body) walk(document.body);
    return blocks.filter(visible).filter(el => el.offsetLeft >= 0);
  }

  /* Statistical head/tail trimming — drops menus, "related articles" and
     comment floods that sit before/after the real body. */
  function gaussianTrim(texts){
    let head = 0;
    let count = 0, mean = 0, sqd = 0;
    for(let i = 0; i < texts.length; i++){
      if(i >= 3 && count > 0 && texts[i].length > mean + 2 * Math.sqrt(sqd / count)){ head = i; break; }
      const d = texts[i].length - mean;
      mean += d / ++count;
      sqd += d * (texts[i].length - mean);
    }
    let tail = texts.length;
    count = 0; mean = 0; sqd = 0;
    for(let i = texts.length - 1; i >= 0; i--){
      if(i < texts.length - 3 && count > 0 && texts[i].length > mean + 2 * Math.sqrt(sqd / count)){ tail = i + 1; break; }
      const d = texts[i].length - mean;
      mean += d / ++count;
      sqd += d * (texts[i].length - mean);
    }
    return { head, tail };
  }

  function blockTexts(threshold){
    const blocks = findTextBlocks(threshold);
    const texts = [];
    for(const b of blocks){
      if(b.dataset.readAloudMulti){
        Array.from(b.children).filter(visible).forEach(c => { const t = textOf(c); if(t) texts.push(t); });
      } else {
        const t = textOf(b);
        if(t) texts.push(t);
      }
    }
    return texts;
  }

  function parseNow(){
    let texts = blockTexts(50);
    let total = texts.reduce((s, t) => s + t.length, 0);
    if(total < 1000){
      texts = blockTexts(3);
      total = texts.reduce((s, t) => s + t.length, 0);
      if(texts.length){
        const { head, tail } = gaussianTrim(texts);
        texts = texts.slice(head, tail);
      }
    }
    return texts.join("\n\n").replace(/[ \t\u00a0]+/g, " ").replace(/ ?\n ?/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  }

  function findNext(){
    try{
      const link = document.querySelector("link[rel='next']");
      if(link && link.href) return link.href;
      const aRel = Array.from(document.querySelectorAll("a[rel='next']")).find(visible);
      if(aRel && aRel.href) return aRel.href;
      /* wtr-lab style: /.../chapter-N → look for chapter-(N+1) on the page */
      const m = location.href.match(/^(.*?chapter-)(\d+)(.*)$/i);
      if(m){
        const want = m[1] + (Number(m[2]) + 1) + m[3];
        const a = document.querySelector(`a[href='${CSS.escape(want)}'], a[href$='${CSS.escape(m[1].replace(location.origin, ""))}${Number(m[2]) + 1}${m[3]}']`);
        if(a && a.href) return a.href;
      }
      const pat = /^(next|next chapter|next page|next part)$/i;
      const a = Array.from(document.querySelectorAll("a")).find(el =>
        visible(el) && el.href && el.href.startsWith(location.origin) &&
        (pat.test((el.textContent || "").trim()) || /next/i.test(el.getAttribute("aria-label") || "")));
      if(a) return a.href;
    }catch(e){}
    return "";
  }

  /* Wait for JS-rendered readers (React/Next SPAs) to hydrate their content. */
  let text = hintText;
  if(!text || text.length < 800 || isSkeleton(text)){
    for(let i = 0; i < 14; i++){
      await new Promise(r => setTimeout(r, 500));
      const hSel = hintSelector();
      if(hSel){
        const el = document.querySelector(hSel);
        if(el) text = textOf(el);
      }
      if(!text || text.length < 800 || isSkeleton(text)) text = parseNow();
      if(text.length >= 800 && !isSkeleton(text)) break;
    }
  }
  if(!text || text.length < 200 || isSkeleton(text)) text = parseNow();
  if(!text || isSkeleton(text)){
    /* Still a loading skeleton — report nothing so the caller retries. */
    return { ...base, text: "", next: "", epubUrls };
  }
  const h = document.querySelector("h1");
  const title = (h && textOf(h)) || base.title;
  if(text && title && !text.slice(0, 200).toLowerCase().includes(String(title).toLowerCase().slice(0, 30))) text = title + "\n\n" + text;
  return { ...base, text, next: findNext(), title: String(title || base.title).slice(0, 160), epubUrls };
}

/* ================= Stash + open the reader ================= */
/* Top-level copy of the skeleton check (the in-page extractor has its own):
   real novel chapters are long; "Opening…"-style SPA skeletons are not. */
const PLACEHOLDER_RE = /^\s*(opening|loading|loading…|please wait|just a moment|initializing)\b/i;
function textIsSkeleton(text){
  const s = String(text || "").replace(/\s+/g, " ").trim();
  if(s.length < 250) return true;
  return PLACEHOLDER_RE.test(s) && s.length < 600;
}

async function stashAndOpen(item, autoplay){
  try{
    await chrome.storage.local.set({ uprPending: { ...item, ts: Date.now(), autoplay: !!autoplay } });
  }catch(e){}
  await openReader();
}

async function openReader(){
  let tabs = [];
  try{ tabs = await chrome.tabs.query({ url: READER_URL + "*" }); }catch(e){}
  if(tabs && tabs.length){
    const t = tabs[0];
    try{ await chrome.tabs.update(t.id, { active: true }); }catch(e){}
    try{ await chrome.windows.update(t.windowId, { focused: true }); }catch(e){}
  } else {
    chrome.tabs.create({ url: READER_URL + "?import=1" });
  }
}

async function readFromTab(tabId, wantSelection){
  const results = await chrome.scripting.executeScript({ target: { tabId }, func: uprExtract });
  const item = results && results[0] && results[0].result;
  if(!item) return { ok: false, error: "No readable text found on this page." };
  /* An index page that links or embeds .epub files (epub.js collection sites)
     → treat it as a book collection and let the reader download the epubs. */
  if(item.kind !== "selection" && item.epubUrls && item.epubUrls.length &&
     (!item.text || item.text.trim().length < 500)){
    return { ok: true, item: { kind: "epub", title: item.title, url: item.url, text: "", next: "", epubUrls: item.epubUrls } };
  }
  if(!item.text || !item.text.trim()) return { ok: false, error: "No readable text found on this page." };
  /* A loading skeleton ("Opening…") is not a chapter — keep the caller retrying. */
  if(item.kind !== "selection" && textIsSkeleton(item.text)){
    return { ok: false, error: "The page is still loading — retrying…" };
  }
  if(wantSelection && item.kind !== "selection") return { ok: false, error: "No text is selected on this page." };
  return { ok: true, item };
}

/* For SPA sites whose text can't be fetched over the network (wtr-lab etc.):
   open the URL in a hidden tab, let it hydrate, extract, close the tab. */
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function waitForTabComplete(tabId, timeoutMs){
  const t0 = Date.now();
  while(Date.now() - t0 < timeoutMs){
    try{
      const t = await chrome.tabs.get(tabId);
      if(t.status === "complete") return true;
    }catch(e){ return false; }
    await sleep(400);
  }
  return false;
}
async function grabViaTab(url){
  let tab;
  try{ tab = await chrome.tabs.create({ url, active: false }); }catch(e){ return null; }
  try{
    await waitForTabComplete(tab.id, 35000);
    await sleep(1500);
    /* Skeletons are rejected by readFromTab now, so keep polling until the
       reader hydrates — hidden tabs hydrate slowly, so allow more attempts. */
    for(let i = 0; i < 14; i++){
      const r = await readFromTab(tab.id, false).catch(() => null);
      if(r && r.ok && ((r.item.text && r.item.text.length >= 600) || r.item.kind === "epub")) return r.item;
      await sleep(900);
    }
    /* Last chance: only accept real text, never a loading skeleton. */
    const r = await readFromTab(tab.id, false).catch(() => null);
    return (r && r.ok && r.item.text && !textIsSkeleton(r.item.text)) ? r.item : null;
  } finally {
    try{ chrome.tabs.remove(tab.id); }catch(e){}
  }
}

/* ================= Context menus ================= */
chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({ id: "upr-read-page", title: "📖 Read this page aloud", contexts: ["page"] });
    chrome.contextMenus.create({ id: "upr-read-sel", title: "🔊 Read the selected text aloud", contexts: ["selection"] });
    chrome.contextMenus.create({ id: "upr-add-page", title: "➕ Add this page to my library", contexts: ["page"] });
    chrome.contextMenus.create({ id: "upr-open", title: "📚 Open Ultra Pro Reader", contexts: ["action"] });
  });
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if(info.menuItemId === "upr-open"){ openReader(); return; }
  if(!tab || !tab.id) return;
  try{
    if(info.menuItemId === "upr-read-sel"){
      const r = await readFromTab(tab.id, true);
      if(r.ok) stashAndOpen(r.item, true);
      else if(chrome.notifications) chrome.notifications.create({ type: "basic", title: "Ultra Pro Reader", message: r.error });
      return;
    }
    if(info.menuItemId === "upr-read-page" || info.menuItemId === "upr-add-page"){
      const r = await readFromTab(tab.id, false);
      if(r.ok) stashAndOpen(r.item, info.menuItemId === "upr-read-page");
      return;
    }
  }catch(e){}
});

/* ================= Popup + reader messages ================= */
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  (async () => {
    try{
      if(msg && msg.type === "openReader"){ await openReader(); sendResponse({ ok: true }); return; }
      if(msg && msg.type === "grabUrl"){
        const item = await grabViaTab(msg.url);
        sendResponse(item ? { ok: true, item } : { ok: false, error: "Could not read that page, even in a hidden tab." });
        return;
      }
      if(msg && (msg.type === "readPage" || msg.type === "readSelection")){
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if(!tab || !tab.id || !/^https?:/i.test(tab.url || "")){
          sendResponse({ ok: false, error: "Open a website tab first, then click again." });
          return;
        }
        const r = await readFromTab(tab.id, msg.type === "readSelection");
        if(!r.ok){ sendResponse(r); return; }
        await stashAndOpen(r.item, msg.type === "readPage");
        sendResponse({ ok: true });
        return;
      }
      sendResponse({ ok: false, error: "Unknown request" });
    }catch(e){ sendResponse({ ok: false, error: String((e && e.message) || e) }); }
  })();
  return true;  /* async sendResponse */
});
