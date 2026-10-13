/* The Plugin Ledger: a small browser for SillyTavern UI extensions.
 *
 * Served by SillyTavern itself (same origin), so it can call the server's own
 * extension API with the session's CSRF token. Opened full screen over the
 * tavern by the ledger-explorer extension; talks back to it via postMessage.
 *
 * Addresses it understands:
 *   ledger://catalog[?f=featured|tools|entered]   the official catalogue
 *   ledger://installed                            plugins entered on this device
 *   ledger://shelf                                bookmarks
 *   ledger://search?q=...                         catalogue + GitHub search
 *   https://github.com/<owner>/<repo>             a plugin's page
 */
(() => {
"use strict";

// ---------------------------------------------------------------- constants
const CATALOG_URL = "https://raw.githubusercontent.com/SillyTavern/SillyTavern-Content/main/index.json";
const HOME = "ledger://catalog";
const LS = { tabs: "ledger.explorer.tabs", shelf: "ledger.explorer.shelf", catalog: "ledger.explorer.catalog", dirty: "ledger.explorer.dirty", sources: "ledger.explorer.sources" };
const CATALOG_TTL = 6 * 3600e3;
const MAX_TABS = 8;

const ICONS = {
  back: '<path d="M15 5l-7 7 7 7"/>',
  fwd: '<path d="M9 5l7 7-7 7"/>',
  reload: '<path d="M20 12a8 8 0 1 1-2.34-5.66"/><path d="M20 4v5h-5"/>',
  close: '<path d="M6 6l12 12M18 6L6 18"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  star: '<path d="M12 3.5l2.6 5.3 5.8.8-4.2 4.1 1 5.8-5.2-2.7-5.2 2.7 1-5.8-4.2-4.1 5.8-.8z"/>',
  starOn: '<path fill="currentColor" d="M12 3.5l2.6 5.3 5.8.8-4.2 4.1 1 5.8-5.2-2.7-5.2 2.7 1-5.8-4.2-4.1 5.8-.8z"/>',
  book: '<path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H20v15H6.5A2.5 2.5 0 0 0 4 20.5z"/><path d="M4 20.5A2.5 2.5 0 0 0 6.5 23H20v-5"/><path d="M8 7h8M8 11h6"/>',
  check: '<path d="M4 12.5l5 5L20 6.5"/>',
  search: '<circle cx="11" cy="11" r="6.5"/><path d="M16 16l4.5 4.5"/>',
  lock: '<rect x="5" y="10.5" width="14" height="10" rx="2"/><path d="M8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5"/>',
  ext: '<path d="M14 4h6v6M20 4l-9 9"/><path d="M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/>',
  clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
  scale: '<path d="M12 4v16M6 20h12M5 8h14M5 8l-2.5 6a3 3 0 0 0 5 0zM19 8l-2.5 6a3 3 0 0 0 5 0z"/>',
  tag: '<path d="M3.5 12.5V4h8.5l8.5 8.5-8.5 8.5z"/><circle cx="8" cy="8.5" r="1.4"/>',
  update: '<path d="M12 4v11M7 10l5 5 5-5"/><path d="M5 20h14"/>',
  trash: '<path d="M5 7h14M10 7V4h4v3M7 7l1 13h8l1-13"/>',
};
const svg = (name) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name]}</svg>`;

// ---------------------------------------------------------------- utilities
const $ = (s, el = document) => el.querySelector(s);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* private mode */ } },
};
const pad2 = (n) => String(n).padStart(2, "0");
const ago = (iso) => {
  const d = (Date.now() - Date.parse(iso)) / 864e5;
  if (!isFinite(d)) return "";
  if (d < 1) return "today";
  if (d < 2) return "yesterday";
  if (d < 45) return `${Math.round(d)} days ago`;
  if (d < 600) return `${Math.round(d / 30)} months ago`;
  return `${(d / 365).toFixed(1)} years ago`;
};
const fmtNum = (n) => (n >= 1000 ? (n / 1000).toFixed(n >= 1e4 ? 0 : 1) + "k" : String(n));

/** owner/repo from anything GitHub-shaped, or null. */
function parseRepo(s) {
  s = String(s || "").trim();
  let m = s.match(/^(?:https?:\/\/)?(?:www\.)?github\.com\/([\w.-]+)\/([\w.-]+?)(?:\.git)?(?:[/?#].*)?$/i);
  if (!m) m = s.match(/^([\w.-]+)\/([\w.-]+?)(?:\.git)?$/);
  if (!m || m[1] === "." || m[2] === ".") return null;
  return { owner: m[1], repo: m[2] };
}
const repoUrl = (r) => `https://github.com/${r.owner}/${r.repo}`;
/** Folder name SillyTavern clones a repo into (path.basename(url, '.git')). */
const folderOf = (url) => (String(url).replace(/\/+$/, "").split("/").pop() || "").replace(/\.git$/i, "");

function toast(msg, kind = "") {
  const t = $("#toast");
  t.textContent = msg;
  t.className = `toast on ${kind}`;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => (t.className = "toast"), 3800);
}

let busy = 0;
function loading(on) {
  busy = Math.max(0, busy + (on ? 1 : -1));
  $("#progress").classList.toggle("on", busy > 0);
}

// ---------------------------------------------------------------- SillyTavern API
let csrf = null;
async function api(path, body) {
  if (!csrf) {
    const r = await fetch("/csrf-token", { credentials: "same-origin" });
    csrf = (await r.json()).token;
  }
  const r = await fetch(path, {
    method: body === undefined ? "GET" : "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json", "X-CSRF-Token": csrf },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await r.text();
  if (!r.ok) {
    const err = new Error(text || `${r.status} ${r.statusText}`);
    err.status = r.status;
    throw err;
  }
  try { return JSON.parse(text); } catch { return text; }
}

/** Map of lower-case folder name -> { folder, global, manifest } for third-party plugins. */
let installed = null;
async function loadInstalled(force) {
  if (installed && !force) return installed;
  const list = await api("/api/extensions/discover");
  const map = new Map();
  await Promise.all(list.filter((e) => e.type !== "system").map(async (e) => {
    const folder = e.name.replace(/^third-party\//, "");
    let manifest = {};
    try { manifest = await (await fetch(`/scripts/extensions/${e.name}/manifest.json`)).json(); } catch { /* unreadable */ }
    map.set(folder.toLowerCase(), { folder, global: e.type === "global", manifest });
  }));
  installed = map;
  return map;
}
const isInstalled = (url) => installed?.get(folderOf(url).toLowerCase());

function markDirty() {
  sessionStorage.setItem(LS.dirty, "1");
  $("#banner").hidden = false;
}

/** Where each installed plugin came from, so Update can fetch it again. */
const sources = {
  get(folder) { return store.get(LS.sources, {})[folder.toLowerCase()]; },
  set(url) { const m = store.get(LS.sources, {}); m[folderOf(url).toLowerCase()] = url; store.set(LS.sources, m); },
};

async function install(url, btn, { global = false, quiet = false } = {}) {
  const label = btn?.innerHTML;
  if (btn) { btn.disabled = true; btn.textContent = "Entering…"; }
  loading(true);
  try {
    const res = await api("/api/extensions/install", { url, global });
    sources.set(url);
    await loadInstalled(true);
    markDirty();
    if (!quiet) toast(`Entered into the ledger: ${res.display_name || folderOf(url)}${res.version ? " v" + res.version : ""}`, "good");
    return res;
  } catch (e) {
    if (!quiet) toast(e.status === 409 ? "That plugin is already entered." : `Could not install: ${e.message.slice(0, 140)}`, "bad");
    if (btn) { btn.disabled = false; btn.innerHTML = label; }
    if (quiet) throw e;
    return null;
  } finally {
    loading(false);
  }
}

/** The repository an installed plugin came from: remembered, catalogued, or its manifest's home page. */
async function sourceOf(entry) {
  const remembered = entry && sources.get(entry.folder);
  if (remembered) return remembered;
  const catalog = await loadCatalog().catch(() => []);
  const listed = catalog.find((x) => folderOf(x.url).toLowerCase() === entry.folder.toLowerCase());
  if (listed) return listed.url;
  const home = parseRepo(entry.manifest.homePage || "");
  return home && home.repo.toLowerCase() === entry.folder.toLowerCase() ? repoUrl(home) : null;
}

/*
 * SillyTavern's own update endpoint shells out to a system `git`, which Android
 * does not have. Install uses SillyTavern's built-in git client, so an update here
 * is: check the repository's manifest version, then remove and install again.
 * The plugin's settings live in SillyTavern's settings and survive this.
 */
async function update(entry, btn) {
  const name = entry.manifest.display_name || entry.folder;
  const url = await sourceOf(entry);
  if (!url) {
    toast(`Can't tell where ${name} came from. Remove it, then install it again from its page.`, "bad");
    return;
  }
  const r = parseRepo(url);
  if (btn) { btn.disabled = true; btn.textContent = "Checking…"; }
  let latest = null;
  try {
    const meta = await ghApi(`repos/${r.owner}/${r.repo}`).catch(() => ({}));
    latest = (await cachedJson(raw(r, meta.default_branch || "HEAD", "manifest.json")))?.version || null;
  } catch { /* unknown; offer the reinstall anyway */ }
  const current = entry.manifest.version || null;
  const same = latest && current && latest === current;
  const ok = await confirmDialog({
    title: same ? `${name} is current` : `Update ${name}?`,
    body: same
      ? `v${current} is the newest version in its repository. Reinstall anyway to pick up any later fixes?`
      : `${current ? "v" + current : "This copy"} will be replaced with ${latest ? "v" + latest : "the repository's latest version"}. Its settings are kept.`,
    yes: same ? "Reinstall" : "Update",
    danger: false,
  });
  if (!ok) { if (btn) { btn.disabled = false; btn.innerHTML = `${svg("update")}Update`; } return; }
  if (btn) btn.textContent = "Updating…";
  loading(true);
  try {
    await api("/api/extensions/delete", { extensionName: entry.folder, global: entry.global });
    try {
      const res = await install(url, null, { global: entry.global, quiet: true });
      toast(`${res.display_name || name} updated${res.version ? " to v" + res.version : ""}.`, "good");
    } catch (e) {
      await loadInstalled(true);
      markDirty();
      toast(`The old copy was removed but the new one failed to install (${e.message.slice(0, 100)}). Tap Install on its page to restore it.`, "bad");
      go(repoUrl(r));
      return;
    }
  } catch (e) {
    toast(`Update failed: ${e.message.slice(0, 140)}`, "bad");
  } finally {
    loading(false);
  }
  render();
}

function confirmDialog({ title, body, yes = "Remove", no = "Keep it", danger = true }) {
  return new Promise((resolve) => {
    $("#modalTitle").textContent = title;
    $("#modalBody").textContent = body;
    $("#modalYes").textContent = yes;
    $("#modalYes").className = `btn ${danger ? "danger" : "primary"}`;
    $("#modalNo").textContent = no;
    $("#modal").hidden = false;
    const done = (v) => { $("#modal").hidden = true; resolve(v); };
    $("#modalYes").onclick = () => done(true);
    $("#modalNo").onclick = () => done(false);
  });
}

async function remove(entry) {
  const ok = await confirmDialog({
    title: `Strike ${entry.manifest.display_name || entry.folder} from the ledger?`,
    body: "The plugin's files are deleted from this device. Its settings stay in your SillyTavern settings in case you enter it again.",
  });
  if (!ok) return false;
  loading(true);
  try {
    await api("/api/extensions/delete", { extensionName: entry.folder, global: entry.global });
    await loadInstalled(true);
    markDirty();
    toast("Struck from the ledger.", "good");
    return true;
  } catch (e) {
    toast(`Could not remove: ${e.message.slice(0, 140)}`, "bad");
    return false;
  } finally {
    loading(false);
  }
}

// ---------------------------------------------------------------- remote data
/** Popular plugins that aren't in the official catalogue, shipped with the app. */
let community = null;
async function loadCommunity() {
  if (community) return community;
  try {
    const r = await fetch("catalog-extra.json");
    community = r.ok ? (await r.json()).items || [] : [];
  } catch { community = []; }
  return community;
}

/** The official catalogue (cached, works offline once fetched) plus the community list. */
async function loadCatalog(force) {
  const extra = await loadCommunity();
  const merge = (official) => {
    const seen = new Set(official.map((x) => folderOf(x.url).toLowerCase()));
    return official.concat(extra.filter((x) => !seen.has(folderOf(x.url).toLowerCase())));
  };
  const cached = store.get(LS.catalog, null);
  if (!force && cached && Date.now() - cached.at < CATALOG_TTL) return merge(cached.items);
  try {
    const r = await fetch(CATALOG_URL, { cache: "no-cache" });
    if (!r.ok) throw new Error(r.status);
    const items = (await r.json()).filter((x) => x.type === "extension" && x.url);
    store.set(LS.catalog, { at: Date.now(), items });
    return merge(items);
  } catch (e) {
    if (cached) return merge(cached.items);
    if (extra.length) return extra;
    throw e;
  }
}

const memo = new Map();
async function cachedJson(url, opts) {
  if (memo.has(url)) return memo.get(url);
  const p = fetch(url, opts).then(async (r) => {
    if (!r.ok) { const e = new Error(`${r.status}`); e.status = r.status; throw e; }
    return r.json();
  });
  memo.set(url, p);
  p.catch(() => memo.delete(url));
  return p;
}
async function cachedText(url) {
  if (memo.has(url)) return memo.get(url);
  const p = fetch(url).then((r) => { if (!r.ok) throw new Error(`${r.status}`); return r.text(); });
  memo.set(url, p);
  p.catch(() => memo.delete(url));
  return p;
}
const ghApi = (path) => cachedJson(`https://api.github.com/${path}`, { headers: { Accept: "application/vnd.github+json" } });
const raw = (r, branch, file) => `https://raw.githubusercontent.com/${r.owner}/${r.repo}/${branch}/${file}`;

async function readme(r, branch) {
  for (const f of ["README.md", "readme.md", "Readme.md", "README.MD", "README"]) {
    try { return { text: await cachedText(raw(r, branch, f)), file: f }; } catch { /* try next */ }
  }
  return null;
}

// ---------------------------------------------------------------- markdown -> sanitised DOM
function renderMarkdown(src) {
  const lines = src.replace(/\r\n?/g, "\n").split("\n");
  const out = [];
  const isBlank = (l) => /^\s*$/.test(l);
  const startsBlock = (l) => /^\s{0,3}(#{1,6}\s|```|~~~|>|[-*+]\s|\d+[.)]\s|<\/?[a-zA-Z]|(\*\s*){3,}$|(-\s*){3,}$|(_\s*){3,}$)/.test(l);
  let i = 0;
  while (i < lines.length) {
    const l = lines[i];
    if (isBlank(l)) { i++; continue; }
    let m;
    if ((m = l.match(/^\s{0,3}(```|~~~)\s*([\w+-]*)/))) {
      const fence = m[1]; const buf = []; i++;
      while (i < lines.length && !lines[i].trim().startsWith(fence)) buf.push(lines[i++]);
      i++;
      out.push(`<pre><code>${esc(buf.join("\n"))}</code></pre>`);
      continue;
    }
    if ((m = l.match(/^\s{0,3}(#{1,6})\s+(.*?)\s*#*\s*$/))) {
      out.push(`<h${m[1].length}>${inline(m[2])}</h${m[1].length}>`); i++; continue;
    }
    if (/^\s{0,3}((\*\s*){3,}|(-\s*){3,}|(_\s*){3,})$/.test(l)) { out.push("<hr>"); i++; continue; }
    if (/^\s{0,3}>/.test(l)) {
      const buf = [];
      while (i < lines.length && !isBlank(lines[i])) buf.push(lines[i++].replace(/^\s{0,3}>\s?/, ""));
      out.push(`<blockquote>${renderMarkdown(buf.join("\n"))}</blockquote>`);
      continue;
    }
    if (l.includes("|") && i + 1 < lines.length && /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(lines[i + 1])) {
      const cells = (row) => row.trim().replace(/^\||\|$/g, "").split("|").map((c) => inline(c.trim()));
      const head = cells(l); i += 2;
      const body = [];
      while (i < lines.length && lines[i].includes("|") && !isBlank(lines[i])) body.push(cells(lines[i++]));
      out.push(`<table><thead><tr>${head.map((c) => `<th>${c}</th>`).join("")}</tr></thead><tbody>${body.map((r) => `<tr>${r.map((c) => `<td>${c}</td>`).join("")}</tr>`).join("")}</tbody></table>`);
      continue;
    }
    if ((m = l.match(/^(\s*)([-*+]|\d+[.)])\s+/))) {
      const ordered = /\d/.test(m[2]);
      const indent = m[1].length;
      const items = [];
      while (i < lines.length) {
        const cur = lines[i];
        const im = cur.match(/^(\s*)([-*+]|\d+[.)])\s+(.*)$/);
        if (im && im[1].length <= indent + 1) { items.push([im[3]]); i++; continue; }
        if (isBlank(cur)) {
          const next = lines[i + 1] || "";
          if (/^\s{2,}\S/.test(next) || new RegExp(`^\\s{0,${indent + 1}}([-*+]|\\d+[.)])\\s`).test(next)) { i++; continue; }
          break;
        }
        if (/^\s{2,}\S/.test(cur) || (!startsBlock(cur) && items.length)) { items[items.length - 1].push(cur.replace(new RegExp(`^\\s{0,${indent + 4}}`), "")); i++; continue; }
        break;
      }
      const tag = ordered ? "ol" : "ul";
      out.push(`<${tag}>${items.map((it) => {
        const body = it.join("\n");
        const html = /\n\s*([-*+]|\d+[.)])\s|\n```/.test(body) ? renderMarkdown(body) : inline(body);
        return `<li>${html.replace(/^<p>([\s\S]*)<\/p>$/, "$1")}</li>`;
      }).join("")}</${tag}>`);
      continue;
    }
    if (/^\s*<\/?[a-zA-Z][\w-]*[\s>/]/.test(l) || /^\s*<!--/.test(l)) {
      const buf = [];
      while (i < lines.length && !isBlank(lines[i])) buf.push(lines[i++]);
      out.push(buf.join("\n"));
      continue;
    }
    const buf = [];
    while (i < lines.length && !isBlank(lines[i]) && !(buf.length && startsBlock(lines[i]))) buf.push(lines[i++]);
    out.push(`<p>${inline(buf.join("\n"))}</p>`);
  }
  return out.join("\n");
}

function inline(s) {
  const keep = [];
  const hold = (html) => `\u0000${keep.push(html) - 1}\u0000`;
  s = s.replace(/(`+)([\s\S]*?[^`])\1(?!`)/g, (_, __, code) => hold(`<code>${esc(code.trim())}</code>`));
  s = s.replace(/<\/?[a-zA-Z][^>]*>/g, (tag) => hold(tag));
  s = esc(s);
  s = s.replace(/!\[([^\]]*)\]\(\s*([^)\s]+)(?:\s+&quot;[^)]*&quot;)?\s*\)/g, (_, alt, src) => hold(`<img alt="${alt}" src="${src}">`));
  s = s.replace(/\[((?:[^\]\u0000]|\u0000\d+\u0000)+)\]\(\s*([^)\s]+)(?:\s+&quot;[^)]*&quot;)?\s*\)/g, (_, text, href) => `<a href="${href}">${text}</a>`);
  s = s.replace(/&lt;(https?:\/\/[^\s&]+)&gt;/g, (_, u) => `<a href="${u}">${u}</a>`);
  s = s.replace(/(^|[\s(])(https?:\/\/[^\s<)]+[^\s<).,;:!?])/g, (_, pre, u) => `${pre}<a href="${u}">${u}</a>`);
  s = s.replace(/\*\*([^*]+)\*\*|__([^_]+)__/g, (_, a, b) => `<strong>${a || b}</strong>`);
  s = s.replace(/(^|[^\w*])\*([^*\s][^*]*?)\*(?!\w)|(^|[^\w_])_([^_\s][^_]*?)_(?!\w)/g, (_, p1, a, p2, b) => `${p1 ?? p2 ?? ""}<em>${a ?? b}</em>`);
  s = s.replace(/~~([^~]+)~~/g, "<del>$1</del>");
  s = s.replace(/ {2,}\n/g, "<br>\n");
  return s.replace(/\u0000(\d+)\u0000/g, (_, n) => keep[n]);
}

const ALLOWED = {
  a: ["href", "title"], img: ["src", "alt", "title", "width", "height"], p: ["align"], div: ["align"], span: [],
  h1: ["align"], h2: ["align"], h3: ["align"], h4: ["align"], h5: [], h6: [], strong: [], b: [], em: [], i: [], u: [], del: [], s: [],
  code: [], pre: [], kbd: [], sub: [], sup: [], br: [], hr: [], blockquote: [], ul: [], ol: ["start"], li: [],
  table: [], thead: [], tbody: [], tr: [], th: ["align", "colspan", "rowspan"], td: ["align", "colspan", "rowspan"],
  details: ["open"], summary: [], picture: [], source: ["srcset", "media"], center: [], small: [], dl: [], dt: [], dd: [],
};
const DROP = new Set(["script", "style", "iframe", "object", "embed", "form", "input", "button", "textarea", "select", "link", "meta", "base", "svg", "math", "template", "frame", "frameset", "noscript", "video", "audio"]);

/** Parse untrusted HTML and keep only an allow-list of tags/attributes; rewrite repo-relative URLs. */
function sanitize(html, r, branch) {
  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, "text/html");
  const blobBase = `https://github.com/${r.owner}/${r.repo}/blob/${branch}/`;
  const rawBase = `https://raw.githubusercontent.com/${r.owner}/${r.repo}/${branch}/`;
  const safeUrl = (u, base, forImg) => {
    if (!u) return null;
    u = u.trim();
    if (u.startsWith("#")) return u;
    let abs;
    try { abs = new URL(u, base); } catch { return null; }
    if (forImg) {
      if (abs.protocol === "data:") return /^data:image\/(png|gif|jpe?g|webp);/i.test(u) ? u : null;
      if (abs.protocol !== "https:") return null;
      // github.com/<o>/<r>/blob|raw/<ref>/<path> images -> raw host
      const m = abs.href.match(/^https:\/\/github\.com\/([^/]+)\/([^/]+)\/(?:blob|raw)\/(.+)$/);
      return m ? `https://raw.githubusercontent.com/${m[1]}/${m[2]}/${m[3]}` : abs.href;
    }
    return ["https:", "http:", "mailto:"].includes(abs.protocol) ? abs.href : null;
  };
  const walk = (node) => {
    for (const el of [...node.children]) {
      const tag = el.tagName.toLowerCase();
      if (DROP.has(tag)) { el.remove(); continue; }
      if (!(tag in ALLOWED)) { walk(el); el.replaceWith(...el.childNodes); continue; }
      for (const a of [...el.attributes]) if (!ALLOWED[tag].includes(a.name)) el.removeAttribute(a.name);
      if (tag === "a") {
        const href = safeUrl(el.getAttribute("href"), blobBase, false);
        href ? el.setAttribute("href", href) : el.removeAttribute("href");
      }
      if (tag === "img") {
        const src = safeUrl(el.getAttribute("src"), rawBase, true);
        if (!src) { el.remove(); continue; }
        el.setAttribute("src", src);
        el.setAttribute("loading", "lazy");
        el.setAttribute("referrerpolicy", "no-referrer");
      }
      if (tag === "source") {
        const set = (el.getAttribute("srcset") || "").split(",")[0].trim().split(/\s+/)[0];
        const src = safeUrl(set, rawBase, true);
        src ? el.setAttribute("srcset", src) : el.remove();
      }
      walk(el);
    }
  };
  walk(doc.body);
  // Strip comments.
  const it = doc.createNodeIterator(doc.body, NodeFilter.SHOW_COMMENT);
  for (let c; (c = it.nextNode());) c.remove();
  const frag = document.createDocumentFragment();
  frag.append(...doc.body.childNodes);
  return frag;
}

// ---------------------------------------------------------------- tabs & history
let state = store.get(LS.tabs, null);
if (!state || !Array.isArray(state.tabs) || !state.tabs.length) state = { tabs: [newTab(HOME)], active: 0 };
state.active = Math.min(state.active, state.tabs.length - 1);
function newTab(url) { return { id: Math.random().toString(36).slice(2), history: [url], index: 0, title: "" }; }
const tab = () => state.tabs[state.active];
const current = () => tab().history[tab().index];
const save = () => store.set(LS.tabs, state);

function go(url, { replace = false } = {}) {
  const t = tab();
  if (replace) t.history[t.index] = url;
  else { t.history = t.history.slice(0, t.index + 1); t.history.push(url); t.index++; if (t.history.length > 60) { t.history.shift(); t.index--; } }
  save();
  render();
}
function step(d) {
  const t = tab();
  const n = t.index + d;
  if (n < 0 || n >= t.history.length) return;
  t.index = n; save(); render();
}
function openTab(url = HOME) {
  if (state.tabs.length >= MAX_TABS) { toast(`Up to ${MAX_TABS} tabs; close one first.`); return; }
  state.tabs.push(newTab(url)); state.active = state.tabs.length - 1; save(); render();
  $("#tabs").lastElementChild.previousElementSibling?.scrollIntoView({ inline: "end", behavior: "smooth" });
}
function closeTab(i) {
  state.tabs.splice(i, 1);
  if (!state.tabs.length) state.tabs.push(newTab(HOME));
  if (state.active >= i) state.active = Math.max(0, state.active - 1);
  save(); render();
}

function renderTabs() {
  const el = $("#tabs");
  el.innerHTML = state.tabs.map((t, i) => `
    <div class="tab${i === state.active ? " on" : ""}" role="tab" aria-selected="${i === state.active}" data-i="${i}">
      <span class="t">${esc(t.title || titleFor(t.history[t.index]))}</span>
      <button class="x" data-close="${i}" aria-label="Close tab">${svg("close")}</button>
    </div>`).join("") + `<button class="tab-new" id="tabNew" aria-label="New tab">${svg("plus")}</button>`;
}

function titleFor(url) {
  if (url.startsWith("ledger://catalog")) return "Catalogue";
  if (url.startsWith("ledger://installed")) return "Entered";
  if (url.startsWith("ledger://shelf")) return "Shelf";
  if (url.startsWith("ledger://search")) return `“${new URL(url.replace("ledger:", "http:")).searchParams.get("q") || ""}”`;
  const r = parseRepo(url);
  return r ? r.repo : url;
}
function setTitle(t) { tab().title = t; save(); renderTabs(); }

function renderChrome() {
  const t = tab(); const url = current();
  $("#btnBack").disabled = t.index === 0;
  $("#btnFwd").disabled = t.index >= t.history.length - 1;
  const omni = $("#omni");
  if (document.activeElement !== omni) omni.value = url.startsWith("https://") ? url.replace(/^https:\/\//, "") : url;
  $("#omniMark").innerHTML = svg(url.startsWith("https://") ? "lock" : "book");
  const shelved = store.get(LS.shelf, []).some((b) => b.url === url);
  $("#btnShelf").innerHTML = svg(shelved ? "starOn" : "star");
  $("#btnShelf").classList.toggle("on", shelved);
  for (const a of document.querySelectorAll(".dock-i")) a.classList.toggle("on", url.startsWith(a.dataset.go));
}

// ---------------------------------------------------------------- pages
const view = () => $("#view");
let renderSeq = 0;

async function render() {
  const seq = ++renderSeq;
  const url = current();
  renderTabs(); renderChrome();
  tab().title = "";
  window.scrollTo(0, 0);
  const live = () => seq === renderSeq;
  loading(true);
  try {
    if (url.startsWith("ledger://catalog")) await pageCatalog(url, live);
    else if (url.startsWith("ledger://installed")) await pageInstalled(live);
    else if (url.startsWith("ledger://shelf")) await pageShelf(live);
    else if (url.startsWith("ledger://search")) await pageSearch(url, live);
    else if (parseRepo(url)) await pagePlugin(parseRepo(url), live);
    else if (live()) view().innerHTML = emptyState("?", "Not in this ledger", "This browser opens SillyTavern plugins: catalogue pages and GitHub repositories.");
  } catch (e) {
    if (live()) view().innerHTML = emptyState("§", "The page could not be read", esc(e.message || String(e)) + `<div class="actions" style="justify-content:center"><button class="btn gilt" data-act="reload">Try again</button></div>`);
  } finally {
    loading(false);
    if (live()) { renderTabs(); renderChrome(); }
  }
}

const emptyState = (glyph, title, body) => `<div class="empty"><div class="glyph">${glyph}</div><h2>${title}</h2><div>${body}</div></div>`;
const skeleton = () => `<div class="card"><div class="card-bd">${'<div class="skel" style="width:60%"></div><div class="skel"></div><div class="skel" style="width:80%"></div>'.repeat(3)}</div></div>`;

function entryRow(item, n) {
  const r = parseRepo(item.url);
  const inst = isInstalled(item.url);
  const ribbon = item.highlight ? '<span class="ribbon">Featured</span>' : item.tool ? '<span class="ribbon tool">Tool</span>'
    : item.community ? `<span class="ribbon community">★ ${fmtNum(item.stars || 0)}</span>` : "";
  return `<li class="entry" data-go="${esc(r ? repoUrl(r) : item.url)}">
    <div class="no">No.&nbsp;${pad2(n)}</div>
    <div><div class="nm">${esc(item.name || r?.repo)}</div><div class="by">by ${esc(r?.owner || "unknown")}</div></div>
    <div class="side">${inst ? '<span class="stamp">Entered</span>' : `<button class="btn small primary" data-install="${esc(item.url)}">Install</button>`}${ribbon}</div>
    <div class="ds">${esc(item.description || "")}</div>
  </li>`;
}

async function pageCatalog(url, live) {
  const f = new URL(url.replace("ledger:", "http:")).searchParams.get("f") || "all";
  view().innerHTML = skeleton();
  const [items] = await Promise.all([loadCatalog(), loadInstalled().catch(() => new Map())]);
  if (!live()) return;
  setTitle("Catalogue");
  const entered = items.filter((x) => isInstalled(x.url));
  const shown = f === "featured" ? items.filter((x) => x.highlight)
    : f === "tools" ? items.filter((x) => x.tool)
    : f === "community" ? items.filter((x) => x.community).sort((a, b) => (b.stars || 0) - (a.stars || 0))
    : f === "entered" ? entered : items;
  const chip = (k, label) => `<button class="chip${f === k ? " on" : ""}" data-go="ledger://catalog${k === "all" ? "" : "?f=" + k}">${label}</button>`;
  view().innerHTML = `
    <div class="mast">
      <div class="monogram">PL</div>
      <div><div class="eyebrow">The Ledger · Folio of Extensions</div><h1>The Plugin Ledger</h1>
      <div class="sub">The official SillyTavern catalogue and the community's most-starred plugins, entered and accounted for.</div></div>
    </div>
    <div class="tally"><span><b>${items.length}</b>in the catalogue</span><span><b>${items.filter((x) => x.community).length}</b>from the community</span><span><b>${installed?.size ?? 0}</b>entered</span></div>
    <div class="chips">${chip("all", "All")}${chip("featured", "Featured")}${chip("community", "Community")}${chip("tools", "Tools")}${chip("entered", "Entered")}</div>
    <div class="card">${shown.length ? `<ol class="entries">${shown.map((x, i) => entryRow(x, i + 1)).join("")}</ol>`
      : emptyState("∅", "No entries", "Nothing in this column yet.")}</div>
    <p class="faint" style="text-align:center;font-size:.86rem">Not listed? Paste any GitHub repository into the address bar.</p>`;
}

async function pageSearch(url, live) {
  const q = (new URL(url.replace("ledger:", "http:")).searchParams.get("q") || "").trim();
  view().innerHTML = skeleton();
  const [items] = await Promise.all([loadCatalog().catch(() => []), loadInstalled().catch(() => new Map())]);
  if (!live()) return;
  setTitle(`“${q}”`);
  const words = q.toLowerCase().split(/\s+/).filter(Boolean);
  const local = items.filter((x) => words.every((w) => `${x.name} ${x.description} ${x.url}`.toLowerCase().includes(w)));
  view().innerHTML = `
    <div class="section-t"><div class="eyebrow">Catalogue</div><span class="faint">${local.length} match${local.length === 1 ? "" : "es"} for “${esc(q)}”</span></div>
    <div class="card">${local.length ? `<ol class="entries">${local.map((x, i) => entryRow(x, i + 1)).join("")}</ol>` : emptyState("∅", "Nothing in the catalogue", "Try the wider stacks below.")}</div>
    <div class="section-t"><div class="eyebrow">The wider stacks · GitHub</div></div>
    <div class="card" id="ghResults">${skeleton()}</div>`;
  try {
    const res = await ghApi(`search/repositories?q=${encodeURIComponent(`${q} sillytavern`)}&sort=stars&order=desc&per_page=20`);
    if (!live()) return;
    const known = new Set(items.map((x) => folderOf(x.url).toLowerCase()));
    const repos = (res.items || []).filter((x) => !known.has(x.name.toLowerCase()));
    $("#ghResults").innerHTML = repos.length ? `<ol class="entries">${repos.map((x, i) => entryRow({
      name: x.name.replace(/[-_]/g, " "), url: x.html_url, description: `${x.description || ""} ★ ${fmtNum(x.stargazers_count)}`,
    }, i + 1)).join("")}</ol>` : emptyState("∅", "No other repositories", "GitHub had nothing else under that name.");
  } catch (e) {
    if (live()) $("#ghResults").innerHTML = emptyState("·", "GitHub search is resting", e.status === 403 ? "GitHub limits searches without an account; try again in a minute." : "Could not reach GitHub.");
  }
}

async function pageInstalled(live) {
  view().innerHTML = skeleton();
  await loadInstalled(true);
  if (!live()) return;
  setTitle("Entered");
  const rows = [...installed.values()].sort((a, b) => (a.manifest.display_name || a.folder).localeCompare(b.manifest.display_name || b.folder));
  view().innerHTML = `
    <div class="mast"><div class="monogram">${rows.length}</div>
      <div><div class="eyebrow">Accounts on this device</div><h1>Entered plugins</h1>
      <div class="sub">Installed third-party extensions. Built-in ones are managed in SillyTavern.</div></div></div>
    <div class="card">${rows.length ? `<ul class="entries">${rows.map((e, i) => `
      <li class="entry" data-folder="${esc(e.folder)}">
        <div class="no">No.&nbsp;${pad2(i + 1)}</div>
        <div><div class="nm">${esc(e.manifest.display_name || e.folder)}</div>
          <div class="by">${esc(e.manifest.author ? "by " + e.manifest.author : e.folder)}${e.manifest.version ? " · v" + esc(e.manifest.version) : ""}${e.global ? " · global" : ""}</div></div>
        <div class="side"><span class="stamp">Entered</span></div>
        <div class="ds"><div class="actions" style="margin-top:6px">
          <button class="btn small" data-update="${esc(e.folder)}">${svg("update")}Update</button>
          <button class="btn small danger" data-remove="${esc(e.folder)}">${svg("trash")}Remove</button>
          ${e.manifest.homePage ? `<button class="btn small ghost" data-go="${esc(e.manifest.homePage)}">${svg("book")}Page</button>` : ""}
        </div></div>
      </li>`).join("")}</ul>`
      : emptyState("∅", "No plugins entered yet", `The catalogue has dozens. <div class="actions" style="justify-content:center"><button class="btn primary" data-go="${HOME}">Open the catalogue</button></div>`)}</div>`;
}

async function pageShelf(live) {
  const shelf = store.get(LS.shelf, []);
  await loadInstalled().catch(() => null);
  if (!live()) return;
  setTitle("Shelf");
  view().innerHTML = `
    <div class="mast"><div class="monogram">${svg("star").replace('stroke-width="1.7"', 'stroke-width="1.4" width="24" height="24"')}</div>
      <div><div class="eyebrow">Kept for later</div><h1>The Shelf</h1><div class="sub">Pages you've bookmarked with the star.</div></div></div>
    <div class="card">${shelf.length ? `<ol class="entries">${shelf.map((b, i) => entryRow({ name: b.title, url: b.url, description: b.note || b.url.replace(/^https:\/\//, "") }, i + 1)).join("")}</ol>`
      : emptyState("☆", "The shelf is bare", "Tap the star in the address bar on any plugin page to keep it here.")}</div>`;
}

async function pagePlugin(r, live) {
  view().innerHTML = skeleton();
  const url = repoUrl(r);
  const [meta, catalog] = await Promise.all([
    ghApi(`repos/${r.owner}/${r.repo}`).catch((e) => ({ _error: e })),
    loadCatalog().catch(() => []),
    loadInstalled().catch(() => new Map()),
  ]);
  if (!live()) return;
  if (meta._error?.status === 404) {
    view().innerHTML = emptyState("§", "No such repository", `github.com/${esc(r.owner)}/${esc(r.repo)} does not exist or is private.`);
    return;
  }
  const branch = meta.default_branch || "HEAD";
  const listed = catalog.find((x) => folderOf(x.url).toLowerCase() === r.repo.toLowerCase() && parseRepo(x.url)?.owner.toLowerCase() === r.owner.toLowerCase());
  const manifest = await cachedJson(raw(r, branch, "manifest.json")).catch(() => null);
  if (!live()) return;
  const name = manifest?.display_name || listed?.name || r.repo;
  setTitle(name);
  const inst = isInstalled(url);
  const isPlugin = !!manifest;
  const metaBits = [
    meta.stargazers_count != null ? `<span>${svg("star")}${fmtNum(meta.stargazers_count)} stars</span>` : "",
    meta.pushed_at ? `<span>${svg("clock")}Updated ${ago(meta.pushed_at)}</span>` : "",
    meta.license?.spdx_id && meta.license.spdx_id !== "NOASSERTION" ? `<span>${svg("scale")}${esc(meta.license.spdx_id)}</span>` : "",
    manifest?.version ? `<span>${svg("tag")}v${esc(manifest.version)}</span>` : "",
  ].join("");
  const primary = inst
    ? `<span class="stamp" style="align-self:center">Entered</span>
       <button class="btn" data-update="${esc(inst.folder)}">${svg("update")}Update</button>
       <button class="btn danger" data-remove="${esc(inst.folder)}">${svg("trash")}Remove</button>`
    : isPlugin ? `<button class="btn primary" data-install="${esc(url)}">${svg("plus")}Install plugin</button>`
    : `<button class="btn" disabled title="No manifest.json at the repository root">Not a SillyTavern plugin</button>`;
  view().innerHTML = `
    <div class="card"><div class="folio">
      <div class="owner">${meta.owner?.avatar_url ? `<img alt="" src="${esc(meta.owner.avatar_url)}&s=56" referrerpolicy="no-referrer">` : ""}
        <div class="eyebrow">${listed?.community ? "Community pick" : listed ? "In the catalogue" : "Uncatalogued"} · ${esc(r.owner)}</div></div>
      <h1>${esc(name)}</h1>
      <p class="lede">${esc(listed?.description || meta.description || "")}</p>
      <div class="meta">${metaBits}</div>
      <div class="actions">${primary}
        <button class="btn ghost" data-external="${esc(url)}">${svg("ext")}GitHub</button></div>
      ${meta._error ? `<p class="faint" style="font-size:.84rem;margin:12px 0 0">GitHub's details are resting (rate limit); the readme and install still work.</p>` : ""}
    </div></div>
    ${manifest ? `<div class="card"><div class="card-hd"><h2>Manifest</h2></div><div class="card-bd"><dl class="manifest">
      ${[["Author", manifest.author], ["Version", manifest.version], ["Requires", (manifest.requires || []).join(", ") || "nothing extra"],
         ["Optional", (manifest.optional || []).join(", ")], ["Min. client", manifest.minimum_client_version], ["Loads", [manifest.js, manifest.css].filter(Boolean).join(" · ")]]
        .filter(([, v]) => v).map(([k, v]) => `<dt>${k}</dt><dd>${esc(v)}</dd>`).join("")}
    </dl></div></div>` : ""}
    <div class="card"><div class="card-hd"><h2>Readme</h2></div><div class="card-bd"><div class="readme" id="readme">${'<div class="skel"></div>'.repeat(6)}</div></div></div>`;
  const md = await readme(r, branch);
  if (!live()) return;
  const el = $("#readme");
  if (!md) { el.innerHTML = '<p class="faint">This repository has no readme.</p>'; return; }
  el.replaceChildren(sanitize(renderMarkdown(md.text), r, branch));
}

// ---------------------------------------------------------------- events
function navigateFromInput(text) {
  text = text.trim();
  if (!text) return;
  if (text.startsWith("ledger://")) return go(text);
  const r = parseRepo(text);
  if (r && (/github\.com/i.test(text) || /^[\w.-]+\/[\w.-]+$/.test(text))) return go(repoUrl(r));
  if (/^https?:\/\//i.test(text)) return openExternal(text);
  go(`ledger://search?q=${encodeURIComponent(text)}`);
}

function openExternal(url) {
  if (window.StPocket?.openExternal) window.StPocket.openExternal(url);
  else window.open(url, "_blank", "noopener");
}

function followLink(href) {
  const r = parseRepo(href);
  const isRepoRoot = r && /^https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/?(?:#.*)?$/i.test(href);
  if (isRepoRoot) go(repoUrl(r));
  else openExternal(href);
}

document.addEventListener("click", async (ev) => {
  const t = ev.target.closest("button, a, .entry, .tab");
  if (!t) return;
  const d = t.dataset;
  if (d.close !== undefined) { ev.stopPropagation(); closeTab(+d.close); return; }
  if (t.id === "tabNew") return openTab();
  if (t.classList.contains("tab")) { state.active = +d.i; save(); render(); return; }
  if (d.install) {
    ev.preventDefault(); ev.stopPropagation();
    if (await install(d.install, t)) render();
    return;
  }
  if (d.update) { ev.stopPropagation(); return update(installed.get(d.update.toLowerCase()), t); }
  if (d.remove) { ev.stopPropagation(); if (await remove(installed.get(d.remove.toLowerCase()))) render(); return; }
  if (d.external) return openExternal(d.external);
  if (d.act === "reload") return render();
  if (d.go) {
    ev.preventDefault();
    if (/^https?:/.test(d.go) && !parseRepo(d.go)) return openExternal(d.go);
    return go(d.go);
  }
  if (t.tagName === "A" && t.closest(".readme")) {
    ev.preventDefault();
    const href = t.getAttribute("href");
    if (href?.startsWith("#")) {
      const target = document.getElementById(href.slice(1)) || [...document.querySelectorAll(".readme h1,.readme h2,.readme h3")]
        .find((h) => h.textContent.trim().toLowerCase().replace(/[^\w]+/g, "-").replace(/^-|-$/g, "") === href.slice(1).toLowerCase());
      target?.scrollIntoView({ behavior: "smooth" });
    } else if (href) followLink(href);
  }
});

$("#bar").addEventListener("submit", (e) => { e.preventDefault(); $("#omni").blur(); navigateFromInput($("#omni").value); });
$("#omni").addEventListener("focus", (e) => setTimeout(() => e.target.select(), 0));
$("#omni").addEventListener("blur", () => setTimeout(renderChrome, 150));
$("#btnBack").onclick = () => step(-1);
$("#btnFwd").onclick = () => step(1);
$("#btnReload").onclick = () => { memo.clear(); if (current().startsWith("ledger://catalog")) store.set(LS.catalog, null); render(); };
$("#btnShelf").onclick = () => {
  const url = current();
  let shelf = store.get(LS.shelf, []);
  if (shelf.some((b) => b.url === url)) { shelf = shelf.filter((b) => b.url !== url); toast("Taken off the shelf."); }
  else { shelf.unshift({ url, title: tab().title || titleFor(url) }); toast("Kept on the shelf.", "good"); }
  store.set(LS.shelf, shelf.slice(0, 100));
  renderChrome();
};
const parentPost = (action) => window.parent !== window && window.parent.postMessage({ source: "ledger-explorer", action }, location.origin);
$("#btnClose").onclick = () => parentPost(sessionStorage.getItem(LS.dirty) ? "close-dirty" : "close");
$("#btnApply").onclick = () => { sessionStorage.removeItem(LS.dirty); parentPost("reload"); };
window.addEventListener("message", (e) => {
  if (e.origin !== location.origin || e.data?.source !== "ledger-host") return;
  if (e.data.action === "back") { if (!$("#modal").hidden) $("#modal").hidden = true; else if (tab().index > 0) step(-1); else parentPost("close"); }
});

// icons
$("#btnBack").innerHTML = svg("back");
$("#btnFwd").innerHTML = svg("fwd");
$("#btnReload").innerHTML = svg("reload");
$("#btnClose").innerHTML = svg("close");
for (const i of document.querySelectorAll("[data-ico]")) i.innerHTML = svg(i.dataset.ico);
$("#banner").hidden = !sessionStorage.getItem(LS.dirty);

// A deep link from the host (e.g. explorer.html#https://github.com/a/b) opens in a new tab.
if (location.hash.length > 1) {
  const target = decodeURIComponent(location.hash.slice(1));
  history.replaceState(null, "", location.pathname);
  const r = parseRepo(target);
  if (r) { state.tabs.push(newTab(repoUrl(r))); state.active = state.tabs.length - 1; if (state.tabs.length > MAX_TABS) state.tabs.shift(), state.active--; }
}
render();
})();
