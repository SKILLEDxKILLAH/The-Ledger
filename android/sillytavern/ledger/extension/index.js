// The Ledger for SillyTavern:
// - the Plugin Ledger: opens the plugin browser (/ledger/explorer.html) full screen
//   over the tavern and handles its requests to close or reload;
// - a phone shell: on narrow screens the row of unlabelled top-bar icons becomes a
//   slim header (Menu, title, Plugins, Characters), a labelled menu of every panel,
//   a Back control for open panels, and a getting-started guide on the welcome screen.

const EXPLORER = '/ledger/explorer.html';
let overlay = null;

function frame() {
    return overlay?.querySelector('iframe');
}

function openExplorer(deepLink) {
    if (overlay) return;
    try { localStorage.setItem('ledger.guide.pluginsSeen', '1'); } catch { /* private mode */ }
    overlay = document.createElement('div');
    overlay.id = 'ledger-explorer';
    const iframe = document.createElement('iframe');
    iframe.title = 'The Plugin Ledger';
    iframe.src = EXPLORER + (deepLink ? '#' + encodeURIComponent(deepLink) : '');
    overlay.append(iframe);
    document.body.append(overlay);
    document.body.classList.add('ledger-explorer-open');
    requestAnimationFrame(() => overlay?.classList.add('on'));
}

function closeExplorer() {
    if (!overlay) return;
    const el = overlay;
    overlay = null;
    document.body.classList.remove('ledger-explorer-open');
    el.classList.remove('on');
    setTimeout(() => el.remove(), 220);
}

function offerReload() {
    if (document.getElementById('ledger-reload-bar')) return;
    const bar = document.createElement('div');
    bar.id = 'ledger-reload-bar';
    bar.innerHTML = '<span>Plugins changed. Reload the tavern to put them to work.</span>';
    const btn = document.createElement('button');
    btn.className = 'menu_button';
    btn.textContent = 'Reload';
    btn.addEventListener('click', () => location.reload());
    const later = document.createElement('button');
    later.className = 'ledger-later';
    later.setAttribute('aria-label', 'Later');
    later.textContent = '×';
    later.addEventListener('click', () => bar.remove());
    bar.append(btn, later);
    document.body.append(bar);
}

window.addEventListener('message', (e) => {
    if (e.origin !== location.origin || e.data?.source !== 'ledger-explorer') return;
    if (e.data.action === 'close') closeExplorer();
    if (e.data.action === 'close-dirty') { closeExplorer(); offerReload(); }
    if (e.data.action === 'reload') location.reload();
});

// The Android app's back gesture asks the page first; true means "handled".
// Order: plugin browser, then the menu, then whichever panel is open.
window.ledgerHandleBack = () => {
    if (overlay) {
        frame()?.contentWindow?.postMessage({ source: 'ledger-host', action: 'back' }, location.origin);
        return true;
    }
    if (menuOpen()) { closeMenu(); return true; }
    if (openPanel()) { closePanel(); return true; }
    return false;
};
window.ledgerOpenExplorer = openExplorer;

function addButton() {
    const holder = document.getElementById('top-settings-holder');
    if (!holder) return false;
    if (document.getElementById('ledger-explorer-button')) return true;
    const wrap = document.createElement('div');
    wrap.id = 'ledger-explorer-button';
    wrap.className = 'drawer';
    wrap.innerHTML = '<div class="ledger-toggle"><div class="drawer-icon fa-solid fa-compass fa-fw closedIcon" title="The Plugin Ledger: browse and install plugins"></div></div>';
    wrap.addEventListener('click', () => openExplorer());
    const ext = document.getElementById('extensions-settings-button');
    if (ext?.nextSibling) holder.insertBefore(wrap, ext.nextSibling);
    else holder.append(wrap);
    return true;
}

// Second way in: the Extensions (magic wand) menu, which layout plugins keep.
function addMenuItem() {
    const menu = document.getElementById('extensionsMenu');
    if (!menu) return false;
    if (document.getElementById('ledger-explorer-menu')) return true;
    const item = document.createElement('div');
    item.id = 'ledger-explorer-menu';
    item.className = 'list-group-item flex-container flexGap5 interactable';
    item.tabIndex = 0;
    item.innerHTML = '<div class="fa-fw fa-solid fa-compass extensionsMenuExtensionButton"></div><span>Plugin Ledger</span>';
    item.addEventListener('click', () => openExplorer());
    menu.append(item);
    return true;
}

// Third way in: if a layout plugin hides the top bar, float a compass instead.
function syncFloatingButton() {
    const top = document.getElementById('ledger-explorer-button');
    const header = document.getElementById('lh-plugins');
    const hidden = (!top || top.offsetParent === null) && (!header || header.offsetParent === null);
    let fab = document.getElementById('ledger-explorer-fab');
    if (hidden && !fab) {
        fab = document.createElement('button');
        fab.id = 'ledger-explorer-fab';
        fab.type = 'button';
        fab.title = 'The Plugin Ledger';
        fab.setAttribute('aria-label', 'Open the Plugin Ledger');
        fab.innerHTML = '<i class="fa-solid fa-compass"></i>';
        fab.addEventListener('click', () => openExplorer());
        document.body.append(fab);
    } else if (!hidden && fab) {
        fab.remove();
    }
}

let tries = 0;
const timer = setInterval(() => {
    const done = addButton() & addMenuItem();
    if (done || ++tries > 120) clearInterval(timer); // give up after 30 s
}, 250);
addButton();
addMenuItem();
setTimeout(syncFloatingButton, 3000);
setInterval(syncFloatingButton, 5000);

// ============================================================== phone shell

const MOBILE = window.matchMedia('(max-width: 1000px)');

/** SillyTavern's top-bar panels: wrapper id, label, what it's for, icon. */
const PANELS = [
    { group: 'Start here', id: 'rightNavHolder', label: 'Characters', hint: 'Pick, create or import a character', icon: 'fa-address-card' },
    { group: 'Start here', id: 'sys-settings-button', label: 'Connect a model', hint: 'API keys and providers: Claude, OpenAI, local and more', icon: 'fa-plug' },
    { group: 'Start here', id: 'persona-management-button', label: 'Your persona', hint: 'Who you are in the story', icon: 'fa-face-smile' },
    { group: 'Writing', id: 'ai-config-button', label: 'Response settings', hint: 'Presets, temperature, reply length', icon: 'fa-sliders' },
    { group: 'Writing', id: 'advanced-formatting-button', label: 'Formatting', hint: 'Prompt templates and system instructions', icon: 'fa-font' },
    { group: 'Writing', id: 'WI-SP-button', label: 'World Info', hint: 'Lorebooks the model can draw on', icon: 'fa-book-atlas' },
    { group: 'Look & add-ons', id: 'backgrounds-button', label: 'Backgrounds', hint: 'Scenery behind the chat', icon: 'fa-panorama' },
    { group: 'Look & add-ons', id: 'user-settings-button', label: 'User settings', hint: 'Theme, chat layout, accessibility', icon: 'fa-user-gear' },
    { group: 'Look & add-ons', id: 'extensions-settings-button', label: 'Extensions', hint: 'Settings for built-in and installed extensions', icon: 'fa-cubes' },
    { group: 'Look & add-ons', id: 'ledger:plugins', label: 'Plugin Ledger', hint: 'Browse and install new plugins', icon: 'fa-compass' },
];

const ctx = () => window.SillyTavern?.getContext?.();
const isDrawer = (id) => /^[\w-]+$/.test(id); // 'ledger:plugins' is ours, not a drawer
const toggleOf = (id) => (isDrawer(id) ? document.querySelector(`#${id} > .drawer-toggle`) : null);
const panelEl = (id) => (isDrawer(id) ? document.querySelector(`#${id} .drawer-content`) : null);
const esc = (t) => String(t ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

function openPanel() {
    return PANELS.find((p) => panelEl(p.id)?.classList.contains('openDrawer') && !panelEl(p.id)?.classList.contains('pinnedOpen'));
}
function showPanel(id) {
    closeMenu();
    if (id === 'ledger:plugins') return openExplorer();
    const open = openPanel();
    if (open?.id === id) return;
    toggleOf(id)?.click(); // SillyTavern's own handler closes any other panel first
}
function closePanel() {
    const open = openPanel();
    if (open) toggleOf(open.id)?.click();
}

// ---- header ------------------------------------------------------------------

function buildHeader() {
    const holder = document.getElementById('top-settings-holder');
    if (!holder || document.getElementById('ledger-header')) return !!holder;
    const header = document.createElement('div');
    header.id = 'ledger-header';
    header.innerHTML = `
        <button type="button" class="lh-btn" id="lh-lead" aria-label="Menu"><i class="fa-solid fa-bars"></i></button>
        <div class="lh-title"><div class="lh-eyebrow">Ledger Tavern</div><div class="lh-name" id="lh-name">Welcome</div></div>
        <button type="button" class="lh-btn" id="lh-plugins" aria-label="Plugins" title="Plugin Ledger"><i class="fa-solid fa-compass"></i></button>
        <button type="button" class="lh-btn" id="lh-chars" aria-label="Characters" title="Characters"><i class="fa-solid fa-address-card"></i></button>`;
    holder.prepend(header);
    header.querySelector('#lh-lead').addEventListener('click', () => (openPanel() ? closePanel() : toggleMenu()));
    header.querySelector('#lh-plugins').addEventListener('click', () => openExplorer());
    header.querySelector('#lh-chars').addEventListener('click', () => {
        if (openPanel()?.id === 'rightNavHolder') closePanel();
        else showPanel('rightNavHolder');
    });
    // Keep the header in step with panels opening and closing.
    new MutationObserver(syncHeader).observe(holder, { subtree: true, attributes: true, attributeFilter: ['class'] });
    syncHeader();
    return true;
}

function syncHeader() {
    const lead = document.getElementById('lh-lead');
    const name = document.getElementById('lh-name');
    if (!lead || !name) return;
    const open = openPanel();
    const c = ctx();
    lead.innerHTML = open ? '<i class="fa-solid fa-arrow-left"></i>' : '<i class="fa-solid fa-bars"></i>';
    lead.setAttribute('aria-label', open ? `Close ${open.label}` : 'Menu');
    name.textContent = open ? open.label : (c?.characterId !== undefined && c?.name2 ? c.name2 : 'Welcome');
    document.getElementById('lh-chars')?.classList.toggle('on', open?.id === 'rightNavHolder');
    document.body.classList.toggle('ledger-panel-open', !!open);
}

// ---- menu --------------------------------------------------------------------

function menuOpen() {
    return document.body.classList.contains('ledger-menu-open');
}
function closeMenu() {
    document.body.classList.remove('ledger-menu-open');
}
function toggleMenu() {
    if (menuOpen()) return closeMenu();
    let sheet = document.getElementById('ledger-menu');
    if (!sheet) {
        sheet = document.createElement('div');
        sheet.id = 'ledger-menu';
        let html = '<div class="lm-scrim"></div><nav class="lm-sheet" aria-label="Menu"><div class="lm-head"><div class="lm-seal">TL</div><div><div class="lh-eyebrow">The Ledger</div><div class="lm-title">Tavern</div></div></div>';
        let group = '';
        for (const p of PANELS) {
            if (p.group !== group) {
                if (group) html += '</div>';
                group = p.group;
                html += `<div class="lm-group"><div class="lm-group-t">${esc(group)}</div>`;
            }
            html += `<button type="button" class="lm-item" data-panel="${p.id}"><i class="fa-solid ${p.icon} fa-fw"></i><span><b>${esc(p.label)}</b><small>${esc(p.hint)}</small></span></button>`;
        }
        html += '</div><button type="button" class="lm-item lm-guide" data-guide="1"><i class="fa-solid fa-signs-post fa-fw"></i><span><b>Getting started</b><small>Show the setup guide again</small></span></button></nav>';
        sheet.innerHTML = html;
        sheet.querySelector('.lm-scrim').addEventListener('click', closeMenu);
        sheet.addEventListener('click', (e) => {
            const item = e.target.closest('.lm-item');
            if (!item) return;
            if (item.dataset.guide) { closeMenu(); closePanel(); resetGuide(); return; }
            showPanel(item.dataset.panel);
        });
        document.body.append(sheet);
    }
    requestAnimationFrame(() => document.body.classList.add('ledger-menu-open'));
}

// ---- getting-started guide ------------------------------------------------------

const GUIDE_KEY = 'ledger.guide.hidden';
const PLUGINS_SEEN = 'ledger.guide.pluginsSeen';
const store = {
    get: (k) => { try { return localStorage.getItem(k); } catch { return null; } },
    set: (k, v) => { try { localStorage.setItem(k, v); } catch { /* private mode */ } },
    del: (k) => { try { localStorage.removeItem(k); } catch { /* private mode */ } },
};

function guideSteps() {
    const c = ctx() || {};
    return [
        { done: c.onlineStatus && c.onlineStatus !== 'no_connection', title: 'Connect a model', body: 'Add an API key for Claude, OpenAI, OpenRouter or a local model.', panel: 'sys-settings-button', cta: 'Connect' },
        { done: c.characterId !== undefined, title: 'Choose a character', body: 'Pick one from the list, or import a card from The Ledger or JanitorAI.', panel: 'rightNavHolder', cta: 'Characters' },
        { done: !!c.name1 && c.name1 !== 'User', title: 'Name your persona', body: 'Tell the story who you are. Optional.', panel: 'persona-management-button', cta: 'Persona' },
        { done: !!store.get(PLUGINS_SEEN), title: 'Add plugins', body: 'Browse the Plugin Ledger for extra features.', panel: 'ledger:plugins', cta: 'Browse' },
    ];
}

function renderGuide() {
    const chat = document.getElementById('chat');
    const existing = document.getElementById('ledger-guide');
    const onWelcome = !!chat?.querySelector('.welcomePanel') || (chat && !chat.querySelector('.mes'));
    const steps = guideSteps();
    const left = steps.filter((s) => !s.done).length;
    if (!chat || !onWelcome || store.get(GUIDE_KEY) || left === 0) {
        existing?.remove();
        return;
    }
    const html = `
        <div class="lg-head">
            <div><div class="lh-eyebrow">Getting started</div><h3>Open the books</h3></div>
            <div class="lg-count">${steps.length - left}<span>/${steps.length}</span></div>
        </div>
        <ol class="lg-steps">${steps.map((s, i) => `
            <li class="${s.done ? 'done' : i === steps.findIndex((x) => !x.done) ? 'next' : ''}">
                <span class="lg-no">${s.done ? '<i class="fa-solid fa-check"></i>' : i + 1}</span>
                <span class="lg-text"><b>${esc(s.title)}</b><small>${esc(s.body)}</small></span>
                ${s.done ? '' : `<button type="button" class="menu_button lg-go" data-panel="${s.panel}">${esc(s.cta)}</button>`}
            </li>`).join('')}
        </ol>
        <button type="button" class="lg-hide">Hide this guide</button>`;
    let card = existing;
    if (!card) {
        card = document.createElement('section');
        card.id = 'ledger-guide';
        card.addEventListener('click', (e) => {
            const go = e.target.closest('.lg-go');
            if (go) {
                if (go.dataset.panel === 'ledger:plugins') store.set(PLUGINS_SEEN, '1');
                showPanel(go.dataset.panel);
            }
            if (e.target.closest('.lg-hide')) { store.set(GUIDE_KEY, '1'); card.remove(); }
        });
    }
    if (card.innerHTML !== html) card.innerHTML = html;
    if (card.parentElement !== chat || chat.firstElementChild !== card) chat.prepend(card);
}

function resetGuide() {
    store.del(GUIDE_KEY);
    renderGuide();
    document.getElementById('ledger-guide')?.scrollIntoView({ behavior: 'smooth' });
}

// ---- wiring ------------------------------------------------------------------

function applyMode() {
    document.body.classList.toggle('ledger-mobile', MOBILE.matches);
    syncHeader();
}

function bootShell() {
    if (!buildHeader()) return false;
    applyMode();
    MOBILE.addEventListener('change', applyMode);
    const c = ctx();
    const types = c?.eventTypes || {};
    for (const t of [types.APP_READY, types.CHAT_CHANGED, types.ONLINE_STATUS_CHANGED, types.SETTINGS_UPDATED, types.CHARACTER_PAGE_LOADED]) {
        if (t) c.eventSource.on(t, () => { syncHeader(); renderGuide(); });
    }
    // The welcome screen is re-rendered by SillyTavern; put the guide back when it is.
    const chat = document.getElementById('chat');
    if (chat) new MutationObserver(() => renderGuide()).observe(chat, { childList: true });
    setTimeout(renderGuide, 500);
    setInterval(() => { syncHeader(); renderGuide(); }, 4000); // persona renames have no event
    return true;
}

let shellTries = 0;
const shellTimer = setInterval(() => {
    if (bootShell() || ++shellTries > 120) clearInterval(shellTimer);
}, 250);
