import { LAB_AUTHORS } from '../data/people';
import { citation, type Publication } from '../data/publications';
import type { Lang } from '../i18n';
import s from './PublicationList.module.css';

export interface PublicationListProps {
  items: Publication[];
  lang: Lang;
  /** 연도 레일을 보일지. 같은 연도가 이어지면 한 번만 찍는다. */
  showYearRail?: boolean;
}

/**
 * 논문 목록 — 텔레메트리 로그 행.
 * 정적 컴포넌트. `client:` 지시어 없이 HTML로만 렌더된다.
 */
export default function PublicationList({
  items,
  lang,
  showYearRail = true,
}: PublicationListProps) {
  let lastYear: number | null = null;

  return (
    <ol className={s.list}>
      {items.map((p, i) => {
        const newYear = p.year !== lastYear;
        lastYear = p.year;

        return (
          <li key={`${p.year}-${i}`} className={s.row} data-reveal="">
            {showYearRail && (
              <span className={newYear ? s.year : s.yearRepeat} aria-hidden={!newYear}>
                {newYear ? p.year : '·'}
              </span>
            )}

            <span className={s.body}>
              <span className={s.title}>{p.title}</span>

              {p.authors.length > 0 && (
                <span className={s.authors}>
                  {p.authors.map((a, j) => (
                    <span key={a + j}>
                      {j > 0 && <span className={s.comma}>, </span>}
                      <span className={LAB_AUTHORS.includes(a) ? s.authorLab : undefined}>{a}</span>
                    </span>
                  ))}
                </span>
              )}

              <span className={s.venue}>{citation(p)}</span>
            </span>

            <span className={s.index} aria-hidden="true">
              {String(items.length - i).padStart(2, '0')}
            </span>
          </li>
        );
      })}
    </ol>
  );
}
