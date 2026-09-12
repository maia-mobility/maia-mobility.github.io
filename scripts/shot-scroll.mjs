/** 스크롤 구간별 화면. 히어로→본문 전환이 자연스러운지 본다. */
import puppeteer from 'puppeteer-core';
const OUT = process.argv[2];
const URL = process.argv[3] ?? 'http://localhost:4321/';
const b = await puppeteer.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true,args:['--no-sandbox','--hide-scrollbars']});
const p = await b.newPage();
await p.setViewport({width:1280,height:820});
await p.goto(URL,{waitUntil:'networkidle0'});
await new Promise(r=>setTimeout(r,3500)); // 부팅 스윕 완료

const H = await p.evaluate(()=>document.documentElement.scrollHeight - window.innerHeight);
console.log('스크롤 가능 높이:', H, 'px');

for (const frac of [0, 0.10, 0.20, 0.30, 0.42, 0.55]) {
  const y = Math.round(H * frac);
  await p.evaluate(v=>window.scrollTo(0,v), y);
  await new Promise(r=>setTimeout(r,900));
  await p.screenshot({path:`${OUT}/scroll-${String(Math.round(frac*100)).padStart(2,'0')}.png`});
  const info = await p.evaluate(()=>{
    const c = document.querySelector('canvas');
    const r = c?.getBoundingClientRect();
    const h1 = document.querySelector('h1')?.getBoundingClientRect();
    const h1el = document.querySelector('h1');
    return { canvasTop: r? Math.round(r.top):null, canvasBottom: r? Math.round(r.bottom):null,
             h1Top: h1? Math.round(h1.top):null,
             h1Op: h1el ? getComputedStyle(h1el).opacity : null };
  });
  console.log(`  ${String(Math.round(frac*100)).padStart(3)}%  y=${String(y).padStart(5)}  캔버스 ${info.canvasTop}~${info.canvasBottom}  h1 top=${info.h1Top} opacity=${info.h1Op}`);
}
await b.close();
