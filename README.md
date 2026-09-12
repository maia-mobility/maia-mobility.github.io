# MAIA Lab 웹사이트

명지대학교 MAIA 연구실(Mobility, AI & Autonomous System) 홈페이지.

## 실행

```bash
npm install
npm run dev          # http://localhost:4321
```

## 검증

```bash
npm run verify       # 타입검사 + 빌드 + 반응형 실측 (개발 서버가 떠 있어야 함)
```

개별 실행: `npm run typecheck` · `npm run build` · `npm run audit`

`audit` 은 실제 Chrome 을 띄워 12개 페이지 × 5개 폭(320/390/768/1280/1920)에서
가로 스크롤, h1 개수, 캔버스 `aria-hidden`, 내비 전환을 측정한다.

## 내용 수정

| 하려는 것 | 파일 |
|---|---|
| 논문 추가 | `src/data/publications.ts` (배열 맨 앞에 추가) |
| 뉴스 추가 | `src/data/news.ts` |
| 구성원 추가 | `src/data/people.ts` 의 `MEMBERS` |
| 강의 추가 | `src/data/teaching.ts` |
| 연구분야 | `src/data/research.ts` |
| 연락처·주소 | `src/data/site.ts` |
| 메뉴·페이지 제목 | `src/i18n/ui.ts` |

모든 내용은 `{ en, ko }` 쌍으로 쓴다. 한쪽만 쓰면 타입 오류가 난다.

## 배포

`.github/workflows/deploy.yml` 참조. 배포 전에 주소를 정해야 한다 —
`astro.config.mjs` 의 `SITE` 또는 저장소 변수 `SITE_URL`.

자세한 규약은 [AGENTS.md](AGENTS.md) 참조.
