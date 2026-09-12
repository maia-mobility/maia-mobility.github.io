/** 순차 등장이 실제로 작동하는지 + JS 꺼짐에서도 보이는지 확인. */
import puppeteer from 'puppeteer-core';
const b = await puppeteer.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true,args:['--no-sandbox','--hide-scrollbars']});

const probe = async (page) => page.evaluate(() => {
  const els = [...document.querySelectorAll('[data-reveal]')];
  const vis = els.filter(e => getComputedStyle(e).opacity !== '0').length;
  return { total: els.length, visible: vis, armed: document.documentElement.hasAttribute('data-reveal-armed') };
});

console.log('── JS 켜짐 ──');
let p = await b.newPage();
await p.setViewport({width:1280,height:900});
await p.goto('http://localhost:4321/publications',{waitUntil:'networkidle0'});
await new Promise(r=>setTimeout(r,600));
console.log('  최초       ', JSON.stringify(await probe(p)));
await p.evaluate(()=>window.scrollTo(0, document.body.scrollHeight/2));
await new Promise(r=>setTimeout(r,1200));
console.log('  절반 스크롤 ', JSON.stringify(await probe(p)));
await p.evaluate(()=>window.scrollTo(0, document.body.scrollHeight));
await new Promise(r=>setTimeout(r,1400));
console.log('  끝까지     ', JSON.stringify(await probe(p)));
await p.close();

console.log('── JS 꺼짐 (전부 보여야 함) ──');
p = await b.newPage();
await p.setJavaScriptEnabled(false);
await p.setViewport({width:1280,height:900});
await p.goto('http://localhost:4321/publications',{waitUntil:'networkidle0'});
const r = await probe(p);
console.log('  ', JSON.stringify(r), r.visible===r.total ? '✓' : '✗ 숨겨진 요소 있음');
await b.close();
