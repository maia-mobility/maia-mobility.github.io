/**
 * 연구분야 시뮬레이션이 실제로 검증된 거동을 내는지 페이지 안에서 읽어 확인한다.
 *   node scripts/sim-check.mjs
 */
import puppeteer from 'puppeteer-core';

const BASE = process.argv[2] ?? 'http://localhost:4321';

const browser = await puppeteer.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: true,
  args: ['--no-sandbox', '--hide-scrollbars'],
});

const page = await browser.newPage();
await page.setViewport({ width: 1400, height: 1000, deviceScaleFactor: 1 });
await page.goto(`${BASE}/research`, { waitUntil: 'networkidle0' });

/** HUD 숫자를 전부 긁어온다. */
const readHud = (areaId) =>
  page.evaluate((id) => {
    const root = document.getElementById(id);
    if (!root) return null;
    const out = {};
    for (const dl of root.querySelectorAll(
      'dl, [class*=metric], [class*=readout], [class*=readings] p',
    )) {
      const txt = dl.textContent?.replace(/\s+/g, ' ').trim();
      if (txt) out.text = (out.text ? out.text + ' | ' : '') + txt;
    }
    if (!out.text) out.text = root.textContent?.replace(/\s+/g, ' ').trim().slice(0, 400);
    const c = root.querySelector('canvas');
    if (c) {
      const g = c.getContext('2d');
      const d = g.getImageData(0, 0, c.width, c.height).data;
      let lit = 0;
      for (let i = 0; i < d.length; i += 4)
        if (d[i] > 24 || d[i + 1] > 24 || d[i + 2] > 28) lit++;
      out.litPct = ((lit / (d.length / 4)) * 100).toFixed(3);
    }
    return out;
  }, areaId);

/** 라벨이 붙은 토글 버튼을 누른다. */
const clickToggle = (areaId, label) =>
  page.evaluate(
    (id, lab) => {
      const root = document.getElementById(id);
      const btns = [...(root?.querySelectorAll('button') ?? [])];
      const b = btns.find((x) => x.textContent?.replace(/\s+/g, ' ').includes(lab));
      if (!b) return false;
      b.click();
      return true;
    },
    areaId,
    label,
  );

const settle = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * HUD 가 "확정됨"을 띄울 때까지 기다린다.
 *
 * 플래툰의 증폭률도 링의 감쇠율도 과도구간에서는 결론값이 아니다(제동파가 후미까지
 * 가야, 링은 2바퀴를 돌아야 정해진다). 그래서 고정 대기 대신 계측기가 스스로
 * SETTLED 를 띄울 때까지 기다린다 — 확정 전의 숫자를 검증에 쓰지 않기 위해서다.
 */
const waitSettled = async (areaId, maxMs = 110000) => {
  const t0 = Date.now();
  while (Date.now() - t0 < maxMs) {
    const ok = await page.evaluate((id) => {
      const p = document.getElementById(id)?.querySelector('[class*=readings] p');
      return (p?.dataset.state ?? '') === 'settled';
    }, areaId);
    if (ok) return ((Date.now() - t0) / 1000).toFixed(0);
    await settle(1000);
  }
  return `>${(maxMs / 1000).toFixed(0)}`;
};

// 모든 시뮬이 화면에 들어와 client:visible 이 붙도록 한 번 훑는다
await page.evaluate(async () => {
  for (const el of document.querySelectorAll('article[id]')) {
    el.scrollIntoView({ block: 'center' });
    await new Promise((r) => setTimeout(r, 350));
  }
  window.scrollTo(0, 0);
});
await settle(1500);

console.log('── 01 platoon · 모드별 증폭률 (사람 > 상용ACC > 제어AV 여야 한다) ──');
await page.evaluate(() => document.getElementById('av-control')?.scrollIntoView({ block: 'center' }));
for (const mode of ['HUMAN', 'COMMERCIAL ACC', 'CONTROLLED AV']) {
  const ok = await clickToggle('av-control', mode);
  const w = await waitSettled('av-control');
  const r = await readHud('av-control');
  console.log(`  ${mode.padEnd(16)} ${ok ? '' : '(토글 못 찾음) '}[확정까지 ${w}s] ${r?.text ?? '?'}`);
}

console.log('\n── 02 shockwave · AV 대수별 속도변동 (단조 감소여야 한다) ──');
await page.evaluate(() => document.getElementById('mixed-traffic')?.scrollIntoView({ block: 'center' }));
for (const av of ['AV 0', 'AV 1', 'AV 2', 'AV 3']) {
  const ok = await clickToggle('mixed-traffic', av);
  const w = await waitSettled('mixed-traffic');
  const r = await readHud('mixed-traffic');
  console.log(`  ${av.padEnd(16)} ${ok ? '' : '(토글 못 찾음) '}[확정까지 ${w}s] ${r?.text ?? '?'}`);
}

console.log('\n── 03·04 · 캔버스가 비어있지 않은지 + 누적 카운터가 실제로 차는지 ──');
// 03 의 첫 운행 완료는 배속 2.2 기준 약 12초, 04 의 첫 합류는 약 10초 걸린다.
// 9초만 기다리면 늘 0 이 나와 검사가 무의미해진다.
for (const id of ['mobility-service', 'cav-cda']) {
  await page.evaluate((i) => document.getElementById(i)?.scrollIntoView({ block: 'center' }), id);
  await settle(18000);
  const r = await readHud(id);
  console.log(`  ${id.padEnd(18)} 밝은픽셀 ${r?.litPct ?? '?'}%  ${r?.text ?? ''}`);
}

await browser.close();
