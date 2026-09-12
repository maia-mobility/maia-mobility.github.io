import { Fragment, useRef, type CSSProperties } from 'react';
import { usePointCloud } from '../hooks/usePointCloud';
import { usePrefersReducedMotion } from '../hooks/usePrefersReducedMotion';
import { SITE } from '../data/site';
import { pick, type Lang } from '../i18n';
import { UI } from '../i18n/ui';
import s from './PointCloudHero.module.css';

/**
 * 계측 표기(HUD). 로케일 무관 — 장비가 찍는 문자열이지 문장이 아니다.
 * 길이가 곧 타이핑 스텝 수라서 CSS 로 그대로 넘긴다.
 */
const HUD_LINE = 'LIDAR ▸ INITIALIZING … 128ch @ 10Hz ▸ ONLINE';

export interface PointCloudHeroProps {
  lang: Lang;
}

/**
 * PointCloudHero — 사이트의 첫 화면이자 **페이지 전체의 배경**.
 *
 * 캔버스는 `usePointCloud` 가 전부 소유한다(씬 생성·rAF·리사이즈·정리).
 * 이 컴포넌트는 `<canvas ref>` 와 마크업만 렌더한다 — 애니메이션 중 state 변화 0.
 * 캔버스는 `aria-hidden`, 내용은 전부 실제 DOM 텍스트다.
 */
export default function PointCloudHero({ lang }: PointCloudHeroProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const reducedMotion = usePrefersReducedMotion();

  // 문서 스크롤이 곧 주행거리다. 훅이 rAF 안에서 직접 읽고, 진행도를
  // `<html>` 의 커스텀 프로퍼티(`--h`·`--p`·`--v`·`--a0`…`--a3`)에 써 넣는다.
  // 도로는 고정 배경이고 본문은 문서 흐름 안이라 — 둘 다 상속으로 읽어야 한다.
  // React state 는 한 번도 바뀌지 않는다.
  usePointCloud(canvasRef, { target: canvasRef, reducedMotion });

  // "Mobility, AI & Autonomous System" → 가운뎃점으로 끊어 계측 라벨처럼 조판한다.
  // (데이터는 건드리지 않는다. 구분자는 표기의 문제다.)
  const parts = pick(SITE.expansion, lang)
    .split(/\s*[,&]\s*/)
    .filter(Boolean);

  const typeVars = { '--type-steps': String(HUD_LINE.length) } as CSSProperties;

  return (
    <div ref={rootRef} className={s.road}>
      {/* 캔버스는 뷰포트에 고정된다 — 푸터의 주소까지 이 도로 위다. */}
      <canvas ref={canvasRef} className={s.canvas} aria-hidden="true" />
      <div className={s.scrim} aria-hidden="true" />

      <section className={s.hero} aria-labelledby="hero-title">
        <div className={s.inner}>
          <p className={s.hud}>
            <span className={s.hudType} style={typeVars}>
              {HUD_LINE}
            </span>
          </p>

          <div className={s.foot}>
            <div className={s.block}>
              <h1 id="hero-title" className={s.title}>
                {SITE.short}
                <span className="visually-hidden"> — {pick(SITE.tagline, lang)}</span>
              </h1>

              <p className={s.expansion}>
                {parts.map((part, i) => (
                  <Fragment key={part}>
                    {i > 0 ? (
                      <span className={s.dot} aria-hidden="true">
                        ·
                      </span>
                    ) : null}
                    <span>{part}</span>
                  </Fragment>
                ))}
              </p>

              <p className={s.lead} lang={lang}>
                {pick(SITE.hero, lang)}
              </p>
            </div>

            <p className={s.scroll}>
              <span>{pick(UI.scroll, lang)}</span>
              <svg
                className={s.arrow}
                viewBox="0 0 10 26"
                width="10"
                height="26"
                fill="none"
                aria-hidden="true"
                focusable="false"
              >
                <path
                  d="M5 0v20M1 16l4 4 4-4"
                  stroke="currentColor"
                  strokeWidth="1"
                  vectorEffect="non-scaling-stroke"
                />
              </svg>
            </p>
          </div>
        </div>
      </section>
    </div>
  );
}
