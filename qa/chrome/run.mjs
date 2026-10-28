// Real Chrome QA for the MeetingPlz extension + web app. Runs headful under xvfb in CI.
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', '..');
const EXT = path.join(ROOT, 'extension', 'dist', 'unpacked');
const OUT = process.env.QA_OUT || path.join(ROOT, 'qa', 'out');
const CHROME = process.env.CHROME_PATH;
const TOKEN = process.env.MP_QA_TOKEN;
const BASE = process.env.MP_BASE || 'https://meetingplz.nonolingo.com';
const EXT_ID = 'afkodmbjfhhmcmihogbkdpknlogjhpfp';
if (!CHROME) throw new Error('CHROME_PATH not set');
if (!TOKEN) throw new Error('MP_QA_TOKEN not set');
fs.mkdirSync(OUT, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const redact = (s) => String(s).split(TOKEN).join('<token>');
async function step(name, fn) {
  const t0 = Date.now();
  try {
    const note = await fn();
    results.push({ name, ok: true, note: note || '', ms: Date.now() - t0 });
    console.log(`PASS ${name}${note ? ' :: ' + redact(note) : ''}`);
  } catch (e) {
    results.push({ name, ok: false, note: redact(e && e.stack || e), ms: Date.now() - t0 });
    console.log(`FAIL ${name} :: ${redact(e && e.message || e)}`);
  }
}
async function shot(page, name) {
  const f = path.join(OUT, `chrome-${name}.png`);
  await page.screenshot({ path: f });
  console.log('screenshot', f);
}
function assert(c, m) { if (!c) throw new Error(m); }

// Find a node by predicate in a pierced DOM tree (works with closed shadow roots).
async function piercedFind(page, pred) {
  const cdp = await page.createCDPSession();
  try {
    const { root } = await cdp.send('DOM.getDocument', { depth: -1, pierce: true });
    const hits = [];
    (function walk(n) {
      if (pred(n)) hits.push(n);
      (n.children || []).forEach(walk);
      (n.shadowRoots || []).forEach(walk);
      if (n.contentDocument) walk(n.contentDocument);
    })(root);
    const dump = [];
    for (const h of hits) {
      try {
        const { model } = await cdp.send('DOM.getBoxModel', { backendNodeId: h.backendNodeId });
        const q = model.content; // x1,y1,...
        dump.push({ x: (q[0] + q[4]) / 2, y: (q[1] + q[5]) / 2, w: model.width, h: model.height, node: h.nodeName });
      } catch { /* not rendered */ }
    }
    return dump;
  } finally { await cdp.detach().catch(() => {}); }
}
function textOf(n) {
  let s = '';
  (function w(x) { if (x.nodeType === 3) s += x.nodeValue; (x.children || []).forEach(w); })(n);
  return s.trim();
}
const isJoinBtn = (n) => /^(BUTTON|A)$/.test(n.nodeName) && /^(Join|Got it)/i.test(textOf(n));

async function waitHost(page, timeout = 15000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) {
    const has = await page.evaluate(() => !!document.querySelector('meetingplz-reminder')).catch(() => false);
    if (has) return Date.now();
    await sleep(100);
  }
  return 0;
}

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: false,
  defaultViewport: null,
  ignoreDefaultArgs: ['--disable-extensions', '--enable-automation'],
  args: [
    '--no-sandbox', '--disable-dev-shm-usage', '--no-first-run', '--no-default-browser-check',
    `--load-extension=${EXT}`, `--disable-extensions-except=${EXT}`,
    '--window-size=1280,900', '--window-position=0,0', '--autoplay-policy=no-user-gesture-required',
  ],
});

let sw; // service worker
let popup; // popup page in a tab
let wiki;

await step('service worker found, id matches', async () => {
  const t = await browser.waitForTarget((x) => x.type() === 'service_worker' && x.url().startsWith('chrome-extension://'), { timeout: 30000 });
  sw = await t.worker();
  const id = new URL(t.url()).host;
  assert(id === EXT_ID, `extension id ${id} != ${EXT_ID}`);
  return id;
});
if (!sw) { await finish(); }

await step('inject token into chrome.storage.local', async () => {
  await sw.evaluate((t) => chrome.storage.local.set({ token: t }), TOKEN);
  const has = await sw.evaluate(() => chrome.storage.local.get('token').then((s) => !!s.token));
  assert(has, 'token not stored');
});

await step('popup signed in', async () => {
  popup = await browser.newPage();
  await popup.setViewport({ width: 360, height: 800, deviceScaleFactor: 2 });
  await popup.goto(`chrome-extension://${EXT_ID}/popup.html`, { waitUntil: 'load' });
  await popup.waitForFunction(() => !document.getElementById('in').hidden || !document.getElementById('out').hidden, { timeout: 15000 });
  await sleep(800);
  await shot(popup, 'popup');
  const info = await popup.evaluate(() => ({
    signedIn: !document.getElementById('in').hidden,
    who: document.getElementById('who').textContent,
    next: document.getElementById('next').innerText.replace(/\s+/g, ' ').trim().slice(0, 140),
  }));
  assert(info.signedIn, 'popup shows signed out although token injected (token invalid?)');
  assert(/daitq3010@gmail\.com/i.test(info.who), `unexpected account: ${info.who}`);
  return `who=${info.who}; next="${info.next}"`;
});

await step('wikipedia Test it: flyby plane + card, Join opens tab', async () => {
  wiki = await browser.newPage();
  await wiki.setViewport({ width: 1280, height: 800 });
  await wiki.goto('https://en.wikipedia.org/wiki/Meeting', { waitUntil: 'domcontentloaded' });
  await popup.bringToFront();
  // same message the popup's Test it button sends; do not await (reply arrives after the reminder shows)
  await popup.evaluate(() => { chrome.runtime.sendMessage({ type: 'test', delayMs: 2000 }, () => {}); });
  await wiki.bringToFront();
  const t0 = await waitHost(wiki, 12000);
  assert(t0, 'reminder host <meetingplz-reminder> never appeared on wikipedia');
  await sleep(1500 - (Date.now() - t0));
  await shot(wiki, 'wiki-plane');
  await sleep(5000 - (Date.now() - t0));
  await shot(wiki, 'wiki-card');
  const joins = await piercedFind(wiki, isJoinBtn);
  assert(joins.length, 'no Join button found in reminder card');
  const before = new Set(browser.targets().map((t) => t.targetId ? t.targetId() : t.url()));
  const newTarget = browser.waitForTarget((t) => t.type() === 'page' && /meet\.google\.com|accounts\.google\.com/.test(t.url()) , { timeout: 15000 });
  const b = joins[0];
  await wiki.mouse.click(b.x, b.y);
  const nt = await newTarget;
  assert(nt, 'no new tab after Join');
  const p = await nt.page().catch(() => null);
  if (p) { await sleep(1500); await shot(p, 'join-tab'); await p.close().catch(() => {}); }
  return `join tab: ${nt.url().slice(0, 60)}`;
});

await step('wikipedia flyby style: plane, page behind stays clickable', async () => {
  const orig = await sw.evaluate(() => chrome.storage.local.get('me').then((s) => (s.me && s.me.settings && s.me.settings.style) || 'flyby'));
  try {
    const r = await popup.evaluate(() => new Promise((res) => chrome.runtime.sendMessage({ type: 'saveSettings', patch: { style: 'flyby' } }, res)));
    assert(r && r.settings && r.settings.style === 'flyby', 'saveSettings flyby failed: ' + JSON.stringify(r).slice(0, 120));
    const w2 = await browser.newPage();
    await w2.setViewport({ width: 1280, height: 800 });
    await w2.goto('https://en.wikipedia.org/wiki/Meeting', { waitUntil: 'domcontentloaded' });
    await popup.bringToFront();
    await popup.evaluate(() => { chrome.runtime.sendMessage({ type: 'test', delayMs: 2000 }, () => {}); });
    await w2.bringToFront();
    const t0 = await waitHost(w2, 12000);
    assert(t0, 'flyby reminder never appeared');
    await sleep(1500 - (Date.now() - t0));
    await shot(w2, 'wiki-flyby-plane');
    await sleep(5000 - (Date.now() - t0));
    await shot(w2, 'wiki-flyby-card');
    const behind = await w2.evaluate(() => { const e = document.elementFromPoint(60, 500); return e ? e.tagName : ''; });
    assert(behind && behind !== 'MEETINGPLZ-REMINDER', 'page behind is blocked in flyby: ' + behind);
    await w2.close();
    return 'element behind: ' + behind;
  } finally {
    await popup.evaluate((o) => new Promise((res) => chrome.runtime.sendMessage({ type: 'saveSettings', patch: { style: o } }, res)), orig).catch(() => {});
  }
});

await step('chrome://extensions page', async () => {
  const p = await browser.newPage();
  await p.setViewport({ width: 1280, height: 800 });
  await p.goto('chrome://extensions', { waitUntil: 'load' });
  await sleep(1500);
  await shot(p, 'extensions');
  await p.close();
});

await step('un-scriptable fallback (chrome://version active): popup window', async () => {
  const v = await browser.newPage();
  await v.goto('chrome://version', { waitUntil: 'load' });
  await popup.bringToFront();
  await popup.evaluate(() => { chrome.runtime.sendMessage({ type: 'test', delayMs: 2000 }, () => {}); });
  await v.bringToFront();
  const wt = await browser.waitForTarget((t) => t.type() === 'page' && t.url().includes('/reminder.html'), { timeout: 15000 });
  const wp = await wt.page();
  await sleep(4500);
  await shot(wp, 'fallback-window');
  const hasHost = await wp.evaluate(() => !!document.querySelector('meetingplz-reminder'));
  assert(hasHost, 'fallback window opened but no reminder rendered');
  // close via the SW so later steps stay clean
  await sw.evaluate(() => chrome.storage.local.get('popupWindowId').then((s) => s.popupWindowId != null && chrome.windows.remove(s.popupWindowId)));
  await v.close().catch(() => {});
});

await step('web app dashboard + Test it', async () => {
  const p = await browser.newPage();
  await p.setViewport({ width: 1280, height: 900 });
  await p.setCookie({ name: 'mp_session', value: TOKEN, domain: new URL(BASE).hostname, path: '/', secure: true, httpOnly: true, sameSite: 'Lax' });
  await p.goto(`${BASE}/app`, { waitUntil: 'networkidle2' });
  await p.waitForSelector('#test-it', { timeout: 20000 });
  await sleep(800);
  await shot(p, 'app-dashboard');
  await p.click('#test-it');
  const t0 = await waitHost(p, 15000);
  assert(t0, 'in-page reminder never appeared after Test it');
  await sleep(4500);
  await shot(p, 'app-reminder');
  await p.close();
});

await finish();

async function finish() {
  fs.writeFileSync(path.join(OUT, 'results.json'), redact(JSON.stringify(results, null, 2)));
  await browser.close().catch(() => {});
  const bad = results.filter((r) => !r.ok);
  console.log(`\n${results.length - bad.length}/${results.length} steps passed`);
  process.exit(bad.length ? 1 : 0);
}
