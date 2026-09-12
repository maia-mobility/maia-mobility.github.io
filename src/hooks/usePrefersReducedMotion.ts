import { useSyncExternalStore } from 'react';

const QUERY = '(prefers-reduced-motion: reduce)';

function subscribe(onChange: () => void): () => void {
  if (typeof window === 'undefined' || !window.matchMedia) return () => {};
  const mq = window.matchMedia(QUERY);
  mq.addEventListener('change', onChange);
  return () => mq.removeEventListener('change', onChange);
}

const getSnapshot = (): boolean =>
  typeof window !== 'undefined' && !!window.matchMedia && window.matchMedia(QUERY).matches;

/** SSR 중에는 항상 false — 서버에는 사용자 설정이 없다. 하이드레이션 후 실제 값으로 정정된다. */
const getServerSnapshot = (): boolean => false;

/**
 * OS의 "동작 줄이기" 설정. 이 값이 true면 모든 애니메이션은 정지 프레임으로 대체한다.
 * 사용자가 설정을 바꾸면 즉시 반영된다.
 */
export function usePrefersReducedMotion(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
