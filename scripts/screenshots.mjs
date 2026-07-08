// Render every Today-view state to screenshots/ for the README and for dev.
//
//   npm run screenshots
//
// Each shot loads sp-dashboard/index.html standalone (mock data) with a
// ?scenario= that fixes the data, plus a faked wall-clock so the block-driven
// states (active block / between-blocks break / squeeze / day's-over) are
// deterministic. The mock day is two blocks — hard Morning 8–2, soft Afternoon
// 4–8 — so the faked clock selects which state renders. Add a scenario by
// dropping an entry in SHOTS below; the mock data lives in index.html's
// standalone bootstrap.
import puppeteer from 'puppeteer';
import path from 'path';
import fs from 'fs';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const OUT = path.join(ROOT, 'screenshots');
const FILE = 'file://' + path.join(ROOT, 'sp-dashboard', 'index.html');

// name, scenario query, "HH:MM" faked clock, optional tab to open, height.
const SHOTS = [
  { name: '01-idle',            scenario: 'idle',            at: '10:00', h: 780, desc: 'Launchpad — the hard morning block, counting down to 2 PM' },
  { name: '02-idle-squeeze',    scenario: 'squeeze',         at: '13:30', h: 780, desc: "Launchpad — the hard block's nearly over and the goal won't fit (squeeze)" },
  { name: '03-idle-goal-met',   scenario: 'met',             at: '17:00', h: 780, desc: 'Launchpad — every lane met for today' },
  { name: '04-day-complete',    scenario: 'idle',            at: '21:00', h: 920, desc: 'Day Complete — past the last block; totals, lanes, streak, week' },
  { name: '04b-day-complete-met', scenario: 'met',           at: '21:00', h: 920, desc: 'Day Complete — daily goal met' },
  { name: '05-idle-no-groups',  scenario: 'empty',           at: '10:00', h: 620, desc: 'Launchpad — no groups yet; time shows as Ungrouped' },
  { name: '06-focus',           scenario: 'focus',           at: '10:30', h: 900, desc: 'Focus — mid-session in the morning block' },
  { name: '07-focus-goal-met',  scenario: 'focus-met',       at: '12:00', h: 900, desc: 'Focus — goal met, stretch to keep rolling' },
  { name: '08-focus-ungrouped', scenario: 'focus-ungrouped', at: '11:20', h: 900, desc: 'Focus — a project in no lane (no daily goal)' },
  // Keep the tab-switching shots (retro/settings) last: opening a tab persists the
  // active view to localStorage, which the next shot would otherwise inherit.
  { name: '11-on-a-break',      scenario: 'idle',            at: '14:45', h: 620, desc: 'On a Break — between blocks; next block preview + prev-block closure' },
  { name: '12-idle-afternoon',  scenario: 'idle',            at: '17:30', h: 780, desc: 'Launchpad — the soft afternoon block; calmer, no squeeze' },
  { name: '09-retrospective',   scenario: 'idle',            at: '10:00', h: 1500, tab: 'tab-retro', desc: 'Retrospective view' },
  { name: '10-settings',        scenario: 'idle',            at: '10:00', h: 760, tab: 'tab-settings', desc: 'Settings view — Work blocks + groups' },
];

const fakeClock = (hhmm) => `(() => {
  const [H, M] = ${JSON.stringify(hhmm)}.split(':').map(Number);
  const OD = Date;
  const base = new OD(); base.setHours(H, M, 0, 0);
  const offset = base.getTime() - OD.now();
  function FakeDate(...a){ return a.length ? new OD(...a) : new OD(OD.now() + offset); }
  FakeDate.prototype = OD.prototype;
  FakeDate.now = () => OD.now() + offset;
  FakeDate.parse = OD.parse; FakeDate.UTC = OD.UTC;
  window.Date = FakeDate;
})();`;

const browser = await puppeteer.launch({ args: ['--no-sandbox', '--disable-setuid-sandbox'] });
fs.mkdirSync(OUT, { recursive: true });

for (const s of SHOTS) {
  const page = await browser.newPage();
  await page.evaluateOnNewDocument(fakeClock(s.at));
  await page.setViewport({ width: 1180, height: s.h, deviceScaleFactor: 2 });
  await page.goto(`${FILE}?scenario=${s.scenario}`, { waitUntil: 'networkidle0' });
  await new Promise(r => setTimeout(r, 900));
  if (s.tab) {
    await page.evaluate((id) => document.getElementById(id).click(), s.tab);
    await new Promise(r => setTimeout(r, 500));
  }
  const out = path.join(OUT, `${s.name}.png`);
  await page.screenshot({ path: out });
  console.log('✓', s.name.padEnd(20), '—', s.desc);
  await page.close();
}

await browser.close();
console.log(`\nWrote ${SHOTS.length} screenshots to ${path.relative(ROOT, OUT)}/`);
