import type { CVEntry, Person } from '../data/people';
import { pick, type Lang } from '../i18n';
import { UI } from '../i18n/ui';
import HudFrame from './HudFrame';
import DotPortrait from './DotPortrait';
import s from './PersonCard.module.css';

export interface PersonCardProps {
  person: Person;
  lang: Lang;
  /** PI는 이력까지 펼쳐 보여준다. */
  detailed?: boolean;
}

function CVList({ entries, lang }: { entries: CVEntry[]; lang: Lang }) {
  return (
    <ol className={s.cv}>
      {entries.map((e, i) => (
        <li key={`${e.period}-${i}`} className={s.cvRow}>
          <span className={s.period}>{e.period}</span>
          <span className={s.cvBody}>
            <span className={s.cvRole}>{pick(e.role, lang)}</span>
            <span className={s.cvOrg} lang={lang}>
              {pick(e.org, lang)}
            </span>
            {e.detail && (
              <span className={s.cvDetail} lang={lang}>
                {pick(e.detail, lang)}
              </span>
            )}
            {e.advisor && (
              <span className={s.cvAdvisor}>
                {pick(UI.advisor, lang)}: {e.advisor}
              </span>
            )}
          </span>
        </li>
      ))}
    </ol>
  );
}

/**
 * 정적 컴포넌트. 사진의 dot 디더 연출은 나중에 `DotPortrait`(client:visible)가
 * 이 자리를 대신한다 — 지금은 순수 <img> 라 JS 없이도 보인다.
 */
export default function PersonCard({ person, lang, detailed = false }: PersonCardProps) {
  const name = pick(person.name, lang);

  return (
    <HudFrame
      as="article"
      edges={['top', 'left']}
      ticks
      label={detailed ? pick(UI.principalInvestigator, lang) : undefined}
      className={detailed ? s.pi : s.member}
    >
      <div className={s.head}>
        {person.photo && (
          <DotPortrait
            className={s.photo}
            src={person.photo}
            alt={name}
            label={person.id.replace(/-/g, '_')}
            width={853}
            height={1280}
          />
        )}

        <div className={s.ident}>
          <h2 className={s.name} lang={lang}>
            {name}
          </h2>
          <p className={s.latin} aria-hidden="true">
            {person.latin}
          </p>

          <p className={s.role} lang={lang}>
            {pick(person.role, lang)}
            {person.since && <span className={s.since}>{person.since}</span>}
          </p>

          {person.affiliation && (
            <p className={s.affil} lang={lang}>
              {pick(person.affiliation, lang)}
            </p>
          )}

          {person.email && (
            <a className={s.email} href={`mailto:${person.email}`}>
              {person.email}
            </a>
          )}
        </div>
      </div>

      {detailed && person.education?.length ? (
        <section className={s.section}>
          <h3 className={s.sectionHead}>{pick(UI.education, lang)}</h3>
          <CVList entries={person.education} lang={lang} />
        </section>
      ) : null}

      {detailed && person.experience?.length ? (
        <section className={s.section}>
          <h3 className={s.sectionHead}>{pick(UI.experience, lang)}</h3>
          <CVList entries={person.experience} lang={lang} />
        </section>
      ) : null}
    </HudFrame>
  );
}
