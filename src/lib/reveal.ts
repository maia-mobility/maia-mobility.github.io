/**
 * 스크롤 등장 연출.
 *
 * 화면에 들어오는 요소가 아래에서 살짝 떠오르며 나타난다. 섹션이 블록처럼 뚝 끊기지 않고
 * 스크롤에 반응하며 이어지게 만드는 장치다.
 *
 * **프레임워크 없이 작성한다** — 콘텐츠 페이지의 JS 0KB 원칙을 지킨다 (AGENTS.md).
 *
 * JS 가 꺼져 있으면 아무 일도 일어나지 않고 모든 요소가 그냥 보인다:
 * CSS 는 `<html data-reveal-armed>` 가 붙었을 때만 요소를 숨기고, 그 속성은 이 스크립트가 단다.
 *
 * **이 파일은 폴백이다.** `animation-timeline: view()` 를 아는 브라우저에서는
 * ScrollReveal.astro 의 스크롤 구동 경로가 진입·퇴장을 양방향으로 처리하므로
 * 여기서는 아무것도 하지 않고 즉시 빠져나간다 (옵저버도, 속성도 만들지 않는다).
 */

export interface RevealOptions {
  /** 뷰포트 아래쪽 이만큼 남았을 때 발동. 너무 늦게 뜨면 스크롤이 어색해진다. */
  rootMargin?: string;
  /** 형제 요소 사이 시차(ms). 0 이면 동시에. */
  stagger?: number;
  /** 한 그룹에서 시차를 줄 최대 개수 — 목록이 길 때 끝없이 밀리는 것을 막는다. */
  staggerMax?: number;
}

const ARMED = 'data-reveal-armed';

export function mountReveal(
  root: ParentNode = document,
  { rootMargin = '0px 0px -12% 0px', stagger = 70, staggerMax = 6 }: RevealOptions = {},
): () => void {
  /*
   * 스크롤 구동 애니메이션을 아는 브라우저는 CSS 가 전부 처리한다.
   * 여기서 옵저버를 만들면 두 경로가 같은 opacity 를 두고 싸운다 — 즉시 빠져나간다.
   * `data-reveal-armed` 도 달지 않으므로 JS 경로의 "숨김" 규칙 자체가 켜지지 않는다.
   */
  if (
    typeof CSS !== 'undefined' &&
    typeof CSS.supports === 'function' &&
    CSS.supports('animation-timeline', 'view()')
  ) {
    return () => {};
  }

  const targets = [...root.querySelectorAll<HTMLElement>('[data-reveal]')];
  if (!targets.length) return () => {};

  const reduced =
    typeof window !== 'undefined' &&
    !!window.matchMedia &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // 동작 줄이기: 연출 없이 전부 보이게 두고 끝낸다.
  if (reduced || typeof IntersectionObserver === 'undefined') {
    for (const el of targets) el.setAttribute('data-reveal', 'in');
    return () => {};
  }

  // 여기서부터 CSS 가 요소를 숨긴다. 스크립트가 살아 있을 때만 켜진다.
  document.documentElement.setAttribute(ARMED, '');

  /** 같은 부모 안에서 몇 번째인지 — 시차용. */
  const indexIn = new Map<HTMLElement, number>();
  const seen = new Map<ParentNode, number>();
  for (const el of targets) {
    const parent = el.parentNode!;
    const n = seen.get(parent) ?? 0;
    indexIn.set(el, Math.min(n, staggerMax));
    seen.set(parent, n + 1);
  }

  const io = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        const el = entry.target as HTMLElement;
        const delay = (indexIn.get(el) ?? 0) * stagger;
        el.style.transitionDelay = delay ? `${delay}ms` : '';
        el.setAttribute('data-reveal', 'in');
        io.unobserve(el); // 한 번 나타나면 끝 — 오갈 때마다 깜빡이면 산만하다
      }
    },
    { rootMargin, threshold: 0 },
  );

  for (const el of targets) {
    // 이미 화면 안(첫 화면)인 요소는 관찰을 거치지 않고 바로 보여준다.
    const r = el.getBoundingClientRect();
    if (r.top < window.innerHeight && r.bottom > 0) {
      el.setAttribute('data-reveal', 'in');
      continue;
    }
    io.observe(el);
  }

  return () => {
    io.disconnect();
    document.documentElement.removeAttribute(ARMED);
  };
}
