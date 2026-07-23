/**
 * The Ledger — headless smoke test.
 * Runs the app in Chromium and checks the core flows with no network.
 * Usage:  node test/smoke.mjs
 * Needs Node + Playwright's Chromium (preinstalled in the web environment at
 * /opt/pw-browsers/chromium; override with PW_CHROMIUM / PW_MODULE env vars).
 */
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const APP = 'file://' + resolve(__dirname, '..', 'index.html');
const PW = process.env.PW_MODULE || '/opt/node22/lib/node_modules/playwright/index.mjs';
const EXE = process.env.PW_CHROMIUM || '/opt/pw-browsers/chromium';

const { chromium } = await import(PW);
const results = [];
const ok = (name, cond, detail = '') => { results.push({ name, pass: !!cond, detail }); };

const browser = await chromium.launch({ executablePath: EXE });
const page = await browser.newPage();
const consoleErrors = [];
page.on('console', m => { if (m.type() === 'error') consoleErrors.push(m.text()); });
page.on('pageerror', e => consoleErrors.push(e.message));

await page.goto(APP);
await page.evaluate(() => localStorage.clear());
await page.reload();
await page.waitForTimeout(250);

ok('title', (await page.title()).includes('The Ledger'));

// blank template + token gauge
await page.click('#btnTemplate');
await page.waitForTimeout(120);
const tok = parseInt(await page.textContent('#tokCount'), 10);
ok('token gauge', tok > 300 && tok < 700, `tok=${tok}`);

// set fields
await page.evaluate(() => {
  const set = (id, v) => { const el = document.querySelector('#' + id); el.value = v; el.dispatchEvent(new Event('input')); };
  set('fName', 'Blair Alcott');
  set('fScenario', 'Trinity gala, 2026.');
  set('fFirst', 'She turned as {user} entered.');
  set('fTags', 'oc, trinity, female');
  set('fAlts', 'Opener A\n---\nOpener B');
});

// JSON export (captured through the downloads shim) + re-import mapping
const jsonRound = await page.evaluate(async () => {
  let cap = null;
  window.claude = { downloads: { save: async ({ filename, data }) => { cap = { filename, data }; return { status: 'saved' }; } } };
  document.querySelector('#btnExportJson').click();
  await new Promise(r => setTimeout(r, 150));
  const card = JSON.parse(await cap.data.text());
  return { filename: cap.filename, spec: card.spec, name: card.data.name, alts: card.data.alternate_greetings.length };
});
ok('json export', jsonRound.spec === 'chara_card_v2' && jsonRound.name === 'Blair Alcott' && jsonRound.alts === 2, JSON.stringify(jsonRound));

// PNG v2 embed + read round-trip
const pngRound = await page.evaluate(async () => {
  let cap = null;
  window.claude = { downloads: { save: async ({ filename, data }) => { cap = { filename, data }; return { status: 'saved' }; } } };
  document.querySelector('#btnExportPng').click();
  await new Promise(r => setTimeout(r, 600));
  const buf = new Uint8Array(await cap.data.arrayBuffer());
  const dv = new DataView(buf.buffer); let off = 8, raw = null;
  const l1 = (a, b) => { let s = ''; for (let i = a; i < b; i++) s += String.fromCharCode(buf[i]); return s; };
  while (off + 8 <= buf.length) {
    const len = dv.getUint32(off), type = l1(off + 4, off + 8);
    if (type === 'tEXt') { let z = off + 8; while (buf[z] !== 0) z++; if (l1(off + 8, z) === 'chara') raw = l1(z + 1, off + 8 + len); }
    off += 12 + len; if (type === 'IEND') break;
  }
  const bin = atob(raw); const u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
  const json = JSON.parse(new TextDecoder().decode(u));
  return { spec: json.spec, name: json.data.name, first: json.data.first_mes };
});
ok('png embed/read', pngRound.spec === 'chara_card_v2' && pngRound.name === 'Blair Alcott' && pngRound.first.includes('{user}'), JSON.stringify(pngRound));

// v1 legacy import mapping
const v1 = await page.evaluate(async () => {
  const card = { name: 'Hailey', description: 'legacy block', scenario: 'UES', first_mes: 'Hi {user}.' };
  const file = new File([JSON.stringify(card)], 'h.json', { type: 'application/json' });
  const dt = new DataTransfer(); dt.items.add(file);
  const input = document.querySelector('#fileImport'); input.files = dt.files;
  input.dispatchEvent(new Event('change'));
  await new Promise(r => setTimeout(r, 200));
  return { name: document.querySelector('#fName').value, prof: document.querySelector('#fProfile').value };
});
ok('v1 import', v1.name === 'Hailey' && v1.prof === 'legacy block', JSON.stringify(v1));

// library save + render
const lib = await page.evaluate(() => {
  document.querySelector('#btnSave').click();
  return JSON.parse(localStorage.getItem('ledger.records.v1') || '[]').length;
});
await page.click('#btnLibrary');
await page.waitForTimeout(120);
const cards = await page.$$eval('.lib-card', els => els.length);
ok('library', lib === 1 && cards === 1, `records=${lib} cards=${cards}`);

// theme toggle
await page.keyboard.press('Escape');
const before = await page.getAttribute('html', 'data-theme');
await page.click('#btnTheme');
const after = await page.getAttribute('html', 'data-theme');
ok('theme toggle', before !== after, `${before}->${after}`);

ok('no console errors', consoleErrors.length === 0, consoleErrors.join(' | '));

await browser.close();

let failed = 0;
for (const r of results) {
  console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${r.name}${r.detail ? '  ' + r.detail : ''}`);
  if (!r.pass) failed++;
}
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
