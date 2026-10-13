// The Plugin Ledger: adds a top-bar button that opens the plugin browser
// (/ledger/explorer.html) full screen over the tavern, and handles its requests
// to close or reload SillyTavern after plugins change.

const EXPLORER = '/ledger/explorer.html';
let overlay = null;

function frame() {
    return overlay?.querySelector('iframe');
}

function openExplorer(deepLink) {
    if (overlay) return;
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
window.ledgerHandleBack = () => {
    if (!overlay) return false;
    frame()?.contentWindow?.postMessage({ source: 'ledger-host', action: 'back' }, location.origin);
    return true;
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

if (!addButton()) {
    const timer = setInterval(() => addButton() && clearInterval(timer), 250);
}
