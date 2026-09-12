import { byTerm, type Course } from '../data/teaching';
import { pick, type Lang } from '../i18n';
import { UI } from '../i18n/ui';
import s from './CourseList.module.css';

export interface CourseListProps {
  lang: Lang;
  /** 지정하지 않으면 전체를 학기별로 묶어서 보여준다. */
  courses?: Course[];
}

/** 정적 컴포넌트 — 학기별 강의 목록. */
export default function CourseList({ lang, courses }: CourseListProps) {
  const groups = courses
    ? [{ term: courses[0]!.term, sort: courses[0]!.sort, courses }]
    : byTerm();

  return (
    <div className={s.wrap}>
      {groups.map((g) => (
        <section key={g.sort} className={s.group}>
          <h3 className={s.term}>
            <span className={s.termLabel}>{pick(g.term, lang)}</span>
            <span className={s.termCount} aria-hidden="true">
              {String(g.courses.length).padStart(2, '0')}
            </span>
          </h3>

          <ul className={s.list}>
            {g.courses.map((c) => (
              <li key={c.id} className={s.row} data-reveal="">
                <span className={s.level}>
                  {pick(c.level === 'graduate' ? UI.graduate : UI.undergraduate, lang)}
                </span>

                <span className={s.body}>
                  <span className={s.title} lang={lang}>
                    {pick(c.title, lang)}
                  </span>
                  <span className={s.program} lang={lang}>
                    {pick(c.program, lang)}
                    {c.note && (
                      <>
                        <span className={s.sep} aria-hidden="true">
                          {' · '}
                        </span>
                        {pick(c.note, lang)}
                      </>
                    )}
                  </span>
                </span>

                {c.code && <span className={s.code}>{c.code}</span>}
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
