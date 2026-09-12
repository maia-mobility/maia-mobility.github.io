import { useEffect, useState, type RefObject } from 'react';

export interface InViewOptions {
  rootMargin?: string;
  threshold?: number | number[];
  /** 한 번 보이면 계속 true 로 둔다 — 등장 연출에 쓴다. */
  once?: boolean;
}

/**
 * 요소가 뷰포트 안에 있는지.
 *
 * 교차할 때만 state 가 바뀐다 — 프레임당 호출이 아니므로 React 로 다뤄도 안전하다.
 * 애니메이션 루프의 on/off 게이트로 쓸 때는 `useRafLoop` 의 `target` 옵션을 쓰는 편이 낫다
 * (그쪽은 state 를 아예 거치지 않는다).
 */
export function useInView<T extends Element>(
  ref: RefObject<T | null>,
  { rootMargin = '0px', threshold = 0, once = false }: InViewOptions = {},
): boolean {
  const [inView, setInView] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    // IntersectionObserver 가 없는 환경에서는 그냥 보이는 것으로 취급한다.
    if (typeof IntersectionObserver === 'undefined') {
      setInView(true);
      return;
    }

    const io = new IntersectionObserver(
      ([entry]) => {
        if (!entry) return;
        if (entry.isIntersecting) {
          setInView(true);
          if (once) io.disconnect();
        } else if (!once) {
          setInView(false);
        }
      },
      { rootMargin, threshold },
    );

    io.observe(el);
    return () => io.disconnect();
  }, [ref, rootMargin, once, JSON.stringify(threshold)]);

  return inView;
}
