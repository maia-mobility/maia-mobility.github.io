/**
 * 비밀값이 저장소에 들어가는 것을 막는다.
 *
 *   npm run lint:secrets
 *
 * **git 이 추적하는 파일만** 본다 — 추적되는 것이 곧 푸시되는 것이고, 푸시된
 * 비밀은 커밋을 되돌려도 히스토리·포크·GitHub 캐시에 남는다. 들어가기 전에 막는
 * 편이 압도적으로 싸다.
 *
 * 정적 사이트라 지금은 비밀이 하나도 없다(환경변수는 SITE_URL·BASE_PATH 뿐이고
 * 둘 다 주소다). 이 검사는 **나중에 생길 때**를 위한 것이다.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

/** 이 파일 자신은 패턴을 품고 있으므로 제외한다. */
const SELF = 'scripts/lint-secrets.mjs';
/** 값이 비어 있는 예시 파일. */
const EXAMPLE = '.env.example';

/**
 * 탐지 규칙.
 *
 * 오탐이 잦으면 사람이 검사를 무시하게 되고, 그러면 검사가 없는 것만 못하다.
 * 그래서 **발급기관이 정한 고유 접두사**가 있는 것 위주로 잡는다. 일반적인
 * `password = "..."` 류는 접두사가 없어 오탐이 많으므로, 값의 길이와 모양까지 본다.
 */
const RULES = [
  { name: 'OpenAI 키', re: /\bsk-[A-Za-z0-9_-]{20,}/g },
  { name: 'Anthropic 키', re: /\bsk-ant-[A-Za-z0-9_-]{20,}/g },
  { name: 'GitHub 토큰', re: /\b(gh[pousr]|github_pat)_[A-Za-z0-9_]{20,}/g },
  { name: 'AWS 액세스 키', re: /\b(AKIA|ASIA)[0-9A-Z]{16}\b/g },
  { name: 'Google API 키', re: /\bAIza[0-9A-Za-z_-]{35}\b/g },
  { name: 'Slack 토큰', re: /\bxox[baprs]-[0-9A-Za-z-]{10,}/g },
  { name: 'Stripe 키', re: /\b[rs]k_(live|test)_[0-9A-Za-z]{20,}/g },
  { name: '개인 키 파일', re: /-----BEGIN (RSA |EC |OPENSSH |PGP )?PRIVATE KEY-----/g },
  { name: 'JWT', re: /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\./g },
  {
    name: '비밀처럼 보이는 대입',
    // key/token/secret/password 류에 20자 이상의 값이 **문자열로** 박힌 경우.
    // 값이 process.env·import.meta.env·빈 문자열이면 잡지 않는다.
    re: /\b(api[_-]?key|secret|password|passwd|token|credential)\s*[:=]\s*['"`](?!\s*['"`])(?!process\.|import\.meta)[^'"`\n]{20,}['"`]/gi,
  },
  {
    name: 'PUBLIC_ 접두사가 붙은 비밀',
    // Astro/Vite 에서 PUBLIC_ 은 **번들에 박혀 브라우저로 나간다.**
    // 이 계열에서 키가 새는 1번 경로다.
    re: /\bPUBLIC_[A-Z0-9_]*(KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL)[A-Z0-9_]*/g,
  },
];

/** 값을 그대로 찍지 않는다 — 로그·CI 출력에 다시 남기지 않기 위해. */
const mask = (s) => (s.length <= 12 ? s[0] + '…' : s.slice(0, 6) + '…' + s.slice(-4));

const tracked = execFileSync('git', ['ls-files', '-z'], { cwd: ROOT, encoding: 'utf8' })
  .split('\0')
  .filter(Boolean);

const findings = [];

/* ① 추적돼서는 안 되는 파일 이름 */
for (const f of tracked) {
  if (/(^|\/)\.env(\.|$)/.test(f) && f !== EXAMPLE) {
    findings.push({ file: f, line: 0, rule: '.env 파일이 추적되고 있다', hit: f });
  }
  if (/\.(pem|key|p12|pfx|keystore|jks)$/i.test(f)) {
    findings.push({ file: f, line: 0, rule: '키 파일이 추적되고 있다', hit: f });
  }
}

/* ② 내용 검사 */
let scanned = 0;
for (const f of tracked) {
  if (f === SELF || f === EXAMPLE) continue;
  const abs = join(ROOT, f);
  let st;
  try {
    st = statSync(abs);
  } catch {
    continue; // 심볼릭 링크가 가리키는 대상이 없을 수 있다
  }
  if (!st.isFile() || st.size > 2_000_000) continue;
  let text;
  try {
    text = readFileSync(abs, 'utf8');
  } catch {
    continue; // 바이너리
  }
  if (text.includes('\0')) continue;
  scanned++;
  const lines = text.split('\n');
  for (const rule of RULES) {
    for (let i = 0; i < lines.length; i++) {
      rule.re.lastIndex = 0;
      const m = rule.re.exec(lines[i]);
      if (m) findings.push({ file: f, line: i + 1, rule: rule.name, hit: m[0] });
    }
  }
}

if (!findings.length) {
  console.log(`✓ 비밀값 없음 (추적 파일 ${tracked.length}개 중 ${scanned}개 검사)`);
  process.exit(0);
}

console.error(`✗ 비밀값으로 보이는 것 ${findings.length}건\n`);
for (const f of findings) {
  console.error(`  ${f.file}${f.line ? ':' + f.line : ''}`);
  console.error(`    ${f.rule} — ${mask(f.hit)}\n`);
}
console.error('이미 커밋했다면 파일만 고치는 것으로 끝나지 않는다.');
console.error('  1. 그 키를 **발급처에서 즉시 폐기**한다 (히스토리에 영원히 남는다)');
console.error('  2. 새 키를 발급받아 .env 에 넣는다 (.env 는 .gitignore 가 막는다)');
process.exit(1);
