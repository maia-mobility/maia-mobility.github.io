import { href, pick, type Lang } from '../i18n';
import { NAV, UI } from '../i18n/ui';
import { SITE } from '../data/site';
import s from './Footer.module.css';

export interface FooterProps {
  lang: Lang;
}

/** 정적 컴포넌트 — `client:` 지시어 없이 HTML로만 렌더된다. */
export default function Footer({ lang }: FooterProps) {
  const c = SITE.contact;

  return (
    <footer className={s.footer} data-quiet>
      <div className={s.inner}>
        <div className={s.lead}>
          <p className={s.mark}>{SITE.short}</p>
          <p className={s.expand}>{pick(SITE.expansion, lang)}</p>
          <p className={s.recruit} lang={lang}>
            {pick(SITE.recruiting, lang)}
          </p>
        </div>

        <div className={s.cols}>
          <section className={s.col}>
            <h2 className={s.colHead}>{pick(UI.sectionContact, lang)}</h2>
            <ul className={s.items}>
              <li>
                <a className={s.mailto} href={`mailto:${c.email}`}>
                  {c.email}
                </a>
              </li>
              <li>
                <a className={s.tel} href={`tel:${c.office.replace(/-/g, '')}`}>
                  {c.office}
                </a>
              </li>
            </ul>
          </section>

          <section className={s.col}>
            <h2 className={s.colHead}>{lang === 'ko' ? '찾아오시는 길' : 'Address'}</h2>
            <address className={s.address} lang={lang}>
              {pick(c.address, lang)}
            </address>
          </section>

          <section className={s.col}>
            <h2 className={s.colHead}>{pick(UI.menu, lang)}</h2>
            <ul className={s.items}>
              {NAV.filter((n) => n.key).map((n) => (
                <li key={n.key}>
                  <a className={s.navLink} href={href(n.key, lang)}>
                    <span className={s.navIndex} aria-hidden="true">
                      {n.index}
                    </span>
                    {pick(n.label, lang)}
                  </a>
                </li>
              ))}
            </ul>
          </section>
        </div>

        <p className={s.colophon}>
          <span>
            © {new Date().getFullYear()} {pick(SITE.name, lang)}
          </span>
          <span className={s.dot} aria-hidden="true">
            ·
          </span>
          <span>{pick(SITE.university, lang)}</span>
        </p>
      </div>
    </footer>
  );
}
