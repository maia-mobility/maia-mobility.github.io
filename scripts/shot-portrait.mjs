/** 인물 사진의 평상시 / 호버 상태를 각각 잡는다. */
import puppeteer from 'puppeteer-core';
const OUT = process.argv[2];
const b = await puppeteer.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: true, args: ['--no-sandbox', '--hide-scrollbars'],
});
const p = await b.newPage();
await p.setViewport({ width: 900, height: 900 });
await p.goto('http://localhost:4321/people', { waitUntil: 'networkidle0' });
await p.evaluate(() => document.querySelector('[data-dot-wrap]')?.scrollIntoView({ block: 'center' }));
await new Promise(r => setTimeout(r, 3500));   // 해상 완료 대기

const box = await (await p.$('[data-dot-wrap]')).boundingBox();
const clip = { x: Math.max(0, box.x - 30), y: Math.max(0, box.y - 30), width: box.width + 420, height: box.height + 60 };

await p.screenshot({ path: `${OUT}/portrait-color-rest.png`, clip });
await p.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
await new Promise(r => setTimeout(r, 700));
await p.screenshot({ path: `${OUT}/portrait-color-hover.png`, clip });

const f = await p.evaluate(() => {
  const img = document.querySelector('[data-dot-wrap] img');
  return getComputedStyle(img).filter;
});
console.log('호버 시 filter:', f);
await b.close();
