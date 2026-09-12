/**
 * 디자인 하드 룰 자동 검사.
 *
 *   npm run lint:design
 *
 * AGENTS.md 의 "디자인 언어 — 타협 불가" 8개 규칙 중 기계로 잡을 수 있는 것을 검사한다.
 * 나머지(여백 감각, 위계, 톤)는 사람이 본다.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

// .pathname 은 퍼센트 인코딩된다 — 한글 경로에서 깨지므로 fileURLToPath 를 쓴다.
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const SRC = join(ROOT, 'src');
const TOKENS_FILE = 'styles/global.css';

/** 검사 대상 파일을 모은다. */
function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(css|tsx|ts|astro)$/.test(name)) out.push(p);
  }
  return out;
}

/**
 * 주석을 지운다 — 주석 속 언급을 위반으로 세지 않기 위해.
 *
 * 중요: 줄 수를 보존해야 한다. 여러 줄 주석을 빈 문자열로 치환하면 개행이 사라져
 * 이후 모든 줄 번호가 밀리고, 엉뚱한 줄이 위반으로 보고된다.
 */
const blank = (m) => m.replace(/[^\n]/g, ' ');

function stripComments(text) {
  return text
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, blank) // JSX {/* ... */}
    .replace(/\/\*[\s\S]*?\*\//g, blank) //      /* ... */
    .replace(/(^|[^:])\/\/.*$/gm, (m, p1) => p1 + ' '.repeat(m.length - p1.length)); // // ...
}

const RULES = [
  {
    id: 'radius',
    label: '규칙1 · border-radius 는 전역 가드 1곳만',
    re: /border-radius\s*:/g,
    allow: (file) => file === TOKENS_FILE,
    max: 1,
  },
  {
    id: 'shadow',
    label: '규칙2 · box-shadow 로 띄운 카드 금지',
    // 콜론 뒤를 통째로 부정 선행 검사한다 — \s*(?!none) 은 백트래킹으로 우회된다
    re: /box-shadow\s*:(?!\s*none\b)/g,
  },
  {
    id: 'gradient',
    label: '규칙5 · 그라디언트·블러 금지',
    re: /(linear-gradient|radial-gradient|conic-gradient|filter\s*:\s*blur|backdrop-filter)/g,
    /*
     * 명시적 예외는 표식(`allow-fade`)으로 선언한다 (AGENTS.md 하드 룰 5).
     * **지금 이 표식을 쓰는 곳은 없다** — 캔버스 하단의 수직 페이드는
     * `PointCloudHero` 에 있었고, 그 컴포넌트는 새 틀로 옮기며 사라졌다.
     *
     * 한때 `allow-plate` 로 본문 뒤 `backdrop-filter` 판을 허용한 적이 있다.
     * 대비는 벌었지만 결과가 프로스티드 글래스 카드라 되돌렸다 — 캔버스 위
     * 본문 가독성은 CSS 가 아니라 `data-quiet` 로 캔버스가 만든다.
     * 표식 없는 gradient·blur·backdrop-filter 는 전부 위반이다.
     */
    allowLine: (line) => /allow-fade/.test(line),
  },
  {
    id: 'arc',
    label: '규칙1 · 캔버스 점은 fillRect (arc 금지)',
    re: /\.arc\s*\(/g,
    only: /^(hooks|components)\//,
  },
  {
    id: 'hex',
    label: '규칙8 · 색상 하드코딩 금지 (토큰만)',
    re: /#[0-9a-fA-F]{3,8}\b/g,
    allow: (file) => file === TOKENS_FILE,
    // <meta name="theme-color"> 는 var() 를 못 받는다 — 유일한 정당한 예외
    allowLine: (line) => /theme-?[Cc]olor/.test(line),
  },
  {
    id: 'setstate-raf',
    label: 'React · rAF 안에서 setState 금지',
    re: /requestAnimationFrame\s*\([^)]*set[A-Z]/g,
  },
];

const files = walk(SRC);
const findings = [];

for (const abs of files) {
  const file = relative(SRC, abs);
  const raw = readFileSync(abs, 'utf8');
  const clean = stripComments(raw);
  const rawLines = raw.split('\n');
  const cleanLines = clean.split('\n');

  for (const rule of RULES) {
    if (rule.only && !rule.only.test(file)) continue;

    const hits = [];
    cleanLines.forEach((line, i) => {
      rule.re.lastIndex = 0;
      if (!rule.re.test(line)) return;
      if (rule.allowLine?.(rawLines[i] ?? '')) return;
      hits.push({ line: i + 1, text: (rawLines[i] ?? '').trim().slice(0, 90) });
    });

    if (!hits.length) continue;

    const allowed = rule.allow?.(file) ? (rule.max ?? Infinity) : 0;
    if (hits.length > allowed) {
      findings.push({ rule, file, hits: hits.slice(allowed) });
    }
  }
}

if (!findings.length) {
  console.log(`✓ 디자인 하드 룰 통과 (${files.length}개 파일 검사)`);
  process.exit(0);
}

const byRule = {};
for (const f of findings) (byRule[f.rule.label] ??= []).push(f);

console.log(`✗ 디자인 하드 룰 위반 ${findings.reduce((n, f) => n + f.hits.length, 0)}건\n`);
for (const [label, list] of Object.entries(byRule)) {
  console.log(label);
  for (const f of list) {
    for (const h of f.hits) {
      console.log(`   src/${f.file}:${h.line}  ${h.text}`);
    }
  }
  console.log('');
}
process.exit(1);
