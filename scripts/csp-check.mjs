/**
 * CSP 가 사이트를 망가뜨리지 않는지 **빌드 산출물에서** 확인한다.
 *
 *   npm run csp:check
 *
 * ★ 반드시 `astro preview`(빌드 결과)로 봐야 한다 ★
 *
 * CSP 는 `astro build` 가 만드는 `<meta>` 로만 나간다 — `astro dev` 에는 없다.
 * 그래서 dev 서버로 확인하면 위반 0건이 나오고, 배포하면 조용히 깨진다.
 * 실제로 그렇게 배포됐다: 인라인 `style=""` 속성이 전부 무시되어 연구 덱의
 * 위치 눈금 넷이 다 켜진 채로 나갔고, 콘솔에는 아무 메시지도 없었다.
 *
 * 위반은 `console` 이 아니라 `securitypolicyviolation` 이벤트로 받는다 —
 * 스타일 속성 차단처럼 콘솔에 안 찍히는 것이 있다.
 */
import { spawn } from 'node:child_process';
import puppeteer from 'puppeteer-core';

const PORT = Number(process.env.CSP_PORT ?? 4399);
const BASE = `http://localhost:${PORT}`;
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

const preview = spawn('npx', ['astro', 'preview', '--port', String(PORT)], {
  stdio: 'ignore',
  detached: false,
});
const stop = () => {
  try {
    preview.kill('SIGTERM');
  } catch {}
};
process.on('exit', stop);

// 서버가 뜰 때까지 기다린다
for (let i = 0; ; i++) {
  try {
    const r = await fetch(BASE + '/', { signal: AbortSignal.timeout(1500) });
    if (r.ok) break;
  } catch {}
  if (i > 40) {
    console.error('✗ preview 서버가 뜨지 않았다');
    stop();
    process.exit(1);
  }
  await new Promise((r) => setTimeout(r, 500));
}

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  args: ['--no-sandbox', '--hide-scrollbars'],
});

let fail = 0;
const say = (ok, msg) => {
  console.log(`  ${ok ? '✓' : '✗'} ${msg}`);
  if (!ok) fail++;
};

const PAGES = ['/', '/ko/', '/research', '/people', '/publications', '/teaching', '/news'];
const allViolations = [];

for (const path of PAGES) {
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 900 });
  await page.evaluateOnNewDocument(() => {
    window.__csp = [];
    document.addEventListener('securitypolicyviolation', (e) => {
      window.__csp.push(`${e.effectiveDirective} ← ${String(e.blockedURI).slice(0, 60)}`);
    });
  });
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message.slice(0, 100)));
  await page.goto(BASE + path, { waitUntil: 'networkidle0' });
  await new Promise((r) => setTimeout(r, 2500));
  const v = await page.evaluate(() => window.__csp ?? []);
  for (const x of v) allViolations.push(`${path}: ${x}`);
  for (const e of errs) allViolations.push(`${path}: JS 오류 — ${e}`);
  await page.close();
}
say(allViolations.length === 0, `CSP 위반·JS 오류 없음 (${PAGES.length}페이지)`);
for (const v of allViolations) console.log(`      ${v}`);

/* 인라인 style 속성이 **실제로 먹는지** 값으로 확인한다.
   CSP 위반 이벤트가 안 잡히는 경우가 있어, 결과를 직접 본다. */
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 900 });
await page.goto(BASE + '/', { waitUntil: 'networkidle0' });
await new Promise((r) => setTimeout(r, 2500));
const top = await page.evaluate(
  () => document.querySelector('[data-deck-room]').getBoundingClientRect().top + window.scrollY,
);
await page.evaluate((y) => window.scrollTo(0, y), Math.round(top + 60));
await new Promise((r) => setTimeout(r, 1500));

const deck = await page.evaluate(() => {
  const ticks = [...document.querySelectorAll('.ticks a')];
  return {
    k: ticks.map((a) => getComputedStyle(a).getPropertyValue('--k').trim()),
    /* `matrix(a, b, c, d, tx, ty)` 의 a 가 scaleX 다. **문자열로 비교하지 마라** —
       `matrix(0.999, …)` 가 `'matrix(0'` 으로 시작해서, 거의 다 채워진 칸을
       비었다고 읽는다(실제로 그렇게 잘못 읽었다). 숫자로 꺼내 쓴다. */
    scaleX: ticks.map((a) => {
      const m = getComputedStyle(a, '::after').transform.match(/matrix\(([-\d.]+)/);
      return m ? Number(m[1]) : 1;
    }),
  };
});
const filled = deck.scaleX.filter((v) => v > 0.5).length;
say(
  deck.k.every((v) => v !== '') && filled === 1,
  `위치 눈금이 현재 칸만 가리킨다 (채워짐 [${deck.scaleX.map((v) => v.toFixed(2)).join(' ')}] · --k=[${deck.k.join(', ')}])`,
);

const portrait = await page.evaluate(async () => {
  const r = await fetch('/people', { headers: { accept: 'text/html' } });
  const t = await r.text();
  return /style="[^"]*aspect-ratio/.test(t);
});
say(portrait, '초상 비율(인라인 style)이 HTML 에 남아 있다');

await browser.close();
stop();
process.exit(fail ? 1 : 0);
