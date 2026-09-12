import type { ElementType, HTMLAttributes, ReactNode } from 'react';
import s from './HudFrame.module.css';

export type HudEdge = 'top' | 'right' | 'bottom' | 'left';
export type HudCorner = 'tl' | 'tr' | 'bl' | 'br';

export interface HudFrameProps extends Omit<HTMLAttributes<HTMLElement>, 'children'> {
  children?: ReactNode;
  /** 1px 선을 그을 변. 기본은 전체 테두리가 아니라 상단+좌측 두 변이다. */
  edges?: HudEdge[];
  /** 코너 틱. true = 네 모서리, 배열 = 지정한 모서리만, false = 없음. */
  ticks?: boolean | HudCorner[];
  /** 프레임 상단 선에 걸터앉는 모노 캡션. */
  label?: string;
  /** 'hot'이면 테두리·틱·라벨이 --accent로 점등된 상태로 고정된다. */
  tone?: 'idle' | 'hot';
  /** hover/focus-within 시 --line → --accent 로 점등하는 변형. */
  interactive?: boolean;
  as?: ElementType;
  className?: string;
}

const EDGE_CLASS: Record<HudEdge, string> = {
  top: s.edgeTop,
  right: s.edgeRight,
  bottom: s.edgeBottom,
  left: s.edgeLeft,
};

const TICK_CLASS: Record<HudCorner, string> = {
  tl: s.tickTl,
  tr: s.tickTr,
  bl: s.tickBl,
  br: s.tickBr,
};

const ALL_CORNERS: HudCorner[] = ['tl', 'tr', 'bl', 'br'];

/**
 * HudFrame — 카드 대체 컨테이너. 정적 컴포넌트이므로 `client:` 지시어 없이
 * HTML로만 렌더된다 (JS 0KB). 상태·이펙트를 절대 들이지 말 것.
 */
export default function HudFrame({
  children,
  edges = ['top', 'left'],
  ticks = true,
  label,
  tone = 'idle',
  interactive = false,
  as,
  className,
  ...rest
}: HudFrameProps) {
  const Tag = (as ?? 'div') as ElementType;

  const corners: HudCorner[] = ticks === true ? ALL_CORNERS : ticks === false ? [] : ticks;

  const classes = [
    s.frame,
    ...edges.map((e) => EDGE_CLASS[e]),
    tone === 'hot' ? s.hot : '',
    interactive ? s.interactive : '',
    label ? s.hasLabel : '',
    className ?? '',
  ]
    .filter(Boolean)
    .join(' ');

  /*
   * `data-quiet` — 배경 도로에게 주는 표식이다(CSS 는 이 속성을 읽지 않는다).
   *
   * 고정 배경으로 점군 도로가 깔린 페이지에서, HudFrame 은 그 위에 **면을 세운다.**
   * 표식이 없으면 도로가 프레임 변까지 그대로 달려와 뚝 끊긴다 — 재질이 바뀐 것이
   * 아니라 **잘린 면**으로 보인다(교수님이 "경계가 어색하다"고 한 자리가 여기다).
   * 표식을 달면 `usePointCloud` 가 프레임에 다가갈수록 점을 성기게 만들어, 도로가
   * 계측기에 **흡수되면서** 끝난다. 도로가 없는 페이지에서는 아무 일도 없다.
   *
   * 값이 `panel` 인 것은 본문(값 없는 `data-quiet`)보다 **더 깊이** 잠그라는 뜻이다 —
   * 글은 도로 위에 얹히지만 계측기는 다른 장비의 화면이라 그 안에 도로가 비치면
   * 수치 위로 점이 지나간다.
   */
  return (
    <Tag className={classes} data-quiet="panel" {...rest}>
      {label ? <span className={s.label}>{label}</span> : null}
      {children}
      {corners.map((c) => (
        <span key={c} className={`${s.tick} ${TICK_CLASS[c]}`} aria-hidden="true" />
      ))}
    </Tag>
  );
}
