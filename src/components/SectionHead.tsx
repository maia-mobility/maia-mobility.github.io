import type { ReactNode } from 'react';
import s from './SectionHead.module.css';

export interface SectionHeadProps {
  /** 2자리 섹션 번호. 예: "02" */
  index: string;
  /** 모노 대문자 라벨. 예: "RESEARCH" */
  label: string;
  /** 압축 헤딩 */
  title: ReactNode;
  /** 선택 — 제목 아래 리드 문장 */
  sub?: ReactNode;
  /** 선택 — 우측 카운터 슬롯. 예: "04 AREAS" */
  meta?: string;
  /** BCP-47 언어 태그. :lang(ko) 조판 규칙(keep-all·트래킹 완화)을 켠다. */
  lang?: string;
  /** 헤딩 레벨. 페이지당 h1은 하나여야 한다. */
  as?: 'h1' | 'h2' | 'h3';
  className?: string;
  id?: string;
}

/**
 * SectionHead — 정적 컴포넌트. `client:` 지시어 없이 HTML로만 렌더된다.
 * 스크램블/스캔 리빌은 나중에 useScanReveal 훅과 함께 붙인다 (지금은 순수 마크업).
 */
export default function SectionHead({
  index,
  label,
  title,
  sub,
  meta,
  lang,
  as = 'h2',
  className,
  id,
}: SectionHeadProps) {
  const Heading = as;

  return (
    <header
      className={[s.head, className ?? ''].filter(Boolean).join(' ')}
      lang={lang}
      id={id}
      data-reveal=""
      data-reveal-kind="head"
    >
      <div className={s.row}>
        <p className={s.eyebrow}>
          <span className={s.index}>{index}</span>
          <span className={s.labelText}>{label}</span>
        </p>
        {meta ? <p className={s.meta}>{meta}</p> : null}
      </div>

      <Heading className={s.title}>{title}</Heading>

      {sub ? <p className={s.sub}>{sub}</p> : null}

      <hr className={s.rule} />
    </header>
  );
}
