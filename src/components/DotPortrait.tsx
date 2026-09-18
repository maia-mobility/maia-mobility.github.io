import s from './DotPortrait.module.css';
import { asset } from '../i18n';

export interface DotPortraitProps {
  src: string;
  /** 스크린리더가 읽을 이름. 캔버스가 아니라 <img> 쪽에 붙는다. */
  alt: string;
  /** 검출 라벨 칩에 쓰이는 식별자. 예: `prof_yu` */
  label?: string;
  width: number;
  height: number;
  className?: string;
  /** 점군이 사진으로 모이는 시간(초). 기본 1.4 — 명단처럼 여럿이 나란히면 짧게. */
  duration?: number;
}

/**
 * 사진이 점군에서 해상되는 인물 사진.
 *
 * **정적 컴포넌트다** — `client:` 지시어를 붙이지 마라.
 * 캔버스는 `src/lib/dotPortrait.ts` 가 바닐라로 구동한다(PeopleBody.astro 의 인라인 스크립트).
 * People 페이지의 유일한 인터랙션이 이것뿐이라 React 런타임을 실을 이유가 없다.
 *
 * `<img>` 가 항상 DOM 에 있고 캔버스는 그 위에 얹힌다 — JS 가 없어도 사진은 그냥 보인다.
 */
export default function DotPortrait({
  src,
  alt,
  label,
  width,
  height,
  className,
  duration,
}: DotPortraitProps) {
  /* `public/` 자산이라 하위 경로 배포에서는 base 가 앞에 붙어야 한다.
     여기 한 곳에서 붙이면 <img> 와 캔버스가 읽는 data-src 가 함께 맞는다. */
  const url = asset(src);
  return (
    <div
      data-dot-wrap
      className={[s.wrap, className ?? ''].filter(Boolean).join(' ')}
      style={{ aspectRatio: `${width} / ${height}` }}
    >
      <img
        className={s.photo}
        src={url}
        alt={alt}
        width={width}
        height={height}
        loading="lazy"
        decoding="async"
      />

      <canvas
        data-dot-portrait
        data-src={url}
        data-duration={duration}
        className={s.canvas}
        aria-hidden="true"
      />

      {label && (
        <span className={s.chip} aria-hidden="true">
          {label}
        </span>
      )}

      {/* 검출 바운딩 박스의 코너 브래킷 — 1px 스트로크 기술 기호 */}
      <span className={s.bracket} aria-hidden="true" />
    </div>
  );
}
