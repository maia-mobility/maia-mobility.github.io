import { formatDate, NEWS_KIND_LABEL, type NewsItem } from '../data/news';
import { pick, type Lang } from '../i18n';
import s from './NewsTimeline.module.css';

export interface NewsTimelineProps {
  items: NewsItem[];
  lang: Lang;
  /** 홈에서는 최근 몇 건만 보여준다. */
  limit?: number;
}

/** 정적 컴포넌트 — 도로를 따라가는 타임라인. */
export default function NewsTimeline({ items, lang, limit }: NewsTimelineProps) {
  const shown = limit ? items.slice(0, limit) : items;

  return (
    <ol className={s.timeline}>
      {shown.map((n) => (
        <li key={n.date} className={s.item} data-reveal="">
          {/* 타임라인 축 위의 마커 — 원이 아니라 사각 점이다 */}
          <span className={s.marker} aria-hidden="true" />

          <div className={s.head}>
            <time className={s.date} dateTime={n.date}>
              {formatDate(n.date, lang)}
            </time>
            <span className={s.kind}>{pick(NEWS_KIND_LABEL[n.kind], lang)}</span>
          </div>

          <p className={s.title} lang={lang}>
            {pick(n.title, lang)}
          </p>

          {n.body && (
            <p className={s.body} lang={lang}>
              {pick(n.body, lang)}
            </p>
          )}
        </li>
      ))}
    </ol>
  );
}
