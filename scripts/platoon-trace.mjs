/**
 * 플래툰 HUD 숫자가 사이클 안에서 어떻게 변하는지 추적한다.
 * 방문자가 아무 때나 봐도 말이 되는 숫자인지 확인하기 위한 것.
 */
import puppeteer from 'puppeteer-core';

const BASE = process.argv[2] ?? 'http://localhost:4321';
const MODES = ['HUMAN', 'COMMERCIAL ACC', 'CONTROLLED AV'];
const SAMPLE_EVERY = 5000;
const DURATION = 60000; // 사이클 45s 보다 길게

const browser = await puppeteer.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: true,
  args: ['--no-sandbox', '--hide-scrollbars'],
});

const page = await browser.newPage();
await page.setViewport({ width: 1400, height: 1000 });
await page.goto(`${BASE}/research`, { waitUntil: 'networkidle0' });
await page.evaluate(() => document.getElementById('av-control')?.scrollIntoView({ block: 'center' }));
await new Promise((r) => setTimeout(r, 2000));

const read = () =>
  page.evaluate(() => {
    const root = document.getElementById('av-control');
    const t = root?.textContent?.replace(/\s+/g, ' ') ?? '';
    const amp = t.match(/Amplification\s*([\d.]+)×/)?.[1];
    const lead = t.match(/Lead drop\s*([\d.]+)/)?.[1];
    const rear = t.match(/Rear drop\s*([\d.]+)/)?.[1];
    return { amp, lead, rear };
  });

for (const mode of MODES) {
  const clicked = await page.evaluate((lab) => {
    const root = document.getElementById('av-control');
    const b = [...(root?.querySelectorAll('button') ?? [])].find((x) =>
      x.textContent?.replace(/\s+/g, ' ').includes(lab),
    );
    b?.click();
    return !!b;
  }, mode);

  const samples = [];
  for (let t = 0; t <= DURATION; t += SAMPLE_EVERY) {
    await new Promise((r) => setTimeout(r, SAMPLE_EVERY));
    const r = await read();
    samples.push(`${((t + SAMPLE_EVERY) / 1000).toString().padStart(2)}s:${r.amp ?? '?'}`);
  }
  const last = await read();
  console.log(
    `${mode.padEnd(15)} ${clicked ? '' : '(토글실패) '}` +
      `선두낙폭 ${last.lead} / 후미낙폭 ${last.rear} km/h\n` +
      `${' '.repeat(16)}${samples.join('  ')}`,
  );
}

await browser.close();
