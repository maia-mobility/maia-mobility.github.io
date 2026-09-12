/**
 * 시나리오별 시뮬레이션 스크린샷.
 *   node scripts/shot-sim.mjs <outDir> [id...]
 */
import puppeteer from 'puppeteer-core';

const OUT = process.argv[2];
const IDS = process.argv.slice(3);
const ids = IDS.length ? IDS : ['av-control', 'mixed-traffic', 'mobility-service', 'cav-cda'];

const b = await puppeteer.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: true,
  args: ['--no-sandbox', '--hide-scrollbars'],
});

for (const [w, h, tag] of [
  [1400, 1000, '1280'],
  [390, 900, '390'],
]) {
  const p = await b.newPage();
  await p.setViewport({ width: w, height: h });
  await p.goto('http://localhost:4321/research', { waitUntil: 'networkidle0' });
  // client:visible 을 모두 붙인다
  await p.evaluate(async () => {
    for (const el of document.querySelectorAll('article[id]')) {
      el.scrollIntoView({ block: 'center' });
      await new Promise((r) => setTimeout(r, 300));
    }
  });
  for (const id of ids) {
    await p.evaluate((i) => document.getElementById(i)?.scrollIntoView({ block: 'center' }), id);
    await new Promise((r) => setTimeout(r, 14000));
    const el = await p.$(`#${id}`);
    if (el) await el.screenshot({ path: `${OUT}/new-${id}-${tag}.png` });
    console.log(`  ${id} @${tag}`);
  }
  await p.close();
}
await b.close();
