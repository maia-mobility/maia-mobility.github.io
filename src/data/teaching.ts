import type { I18nText } from '../i18n/types';

export type Level = 'undergraduate' | 'graduate';

export interface Course {
  id: string;
  /** `2026 Spring` — 학기. */
  term: I18nText;
  /** 정렬용. 2026 Spring = 2026.1, Fall = 2026.2 */
  sort: number;
  title: I18nText;
  level: Level;
  program: I18nText;
  /** `Freshmen Course` 등. */
  note?: I18nText;
  code?: string;
}

/** 최신 학기부터. */
export const COURSES: Course[] = [
  {
    id: '2026s-intro-engineering-design',
    term: { en: '2026 Spring', ko: '2026학년도 1학기' },
    sort: 2026.1,
    title: {
      en: 'Introduction of Engineering Design',
      ko: '공학입문설계',
    },
    level: 'undergraduate',
    program: {
      en: 'Smart Mobility Engineering Major',
      ko: '스마트모빌리티공학전공',
    },
    note: { en: 'Freshmen course', ko: '1학년 과목' },
  },
  {
    id: '2026s-traffic-demand-forecast',
    term: { en: '2026 Spring', ko: '2026학년도 1학기' },
    sort: 2026.1,
    title: {
      en: 'Traffic Demand Forecast',
      ko: '교통수요예측',
    },
    level: 'undergraduate',
    program: {
      en: 'Global Infrastructure Engineering Major',
      ko: '글로벌인프라공학전공',
    },
    note: { en: 'Sophomore course', ko: '2학년 과목' },
  },
  {
    id: '2026s-intro-smart-infra',
    term: { en: '2026 Spring', ko: '2026학년도 1학기' },
    sort: 2026.1,
    title: {
      en: 'Introduction of Smart Infrastructure Engineering',
      ko: '스마트인프라공학개론',
    },
    level: 'undergraduate',
    program: {
      en: 'Global Infrastructure Engineering Major',
      ko: '글로벌인프라공학전공',
    },
    note: { en: 'Freshmen course', ko: '1학년 과목' },
  },
];

/** 학기별 묶음 — 최신 학기가 먼저. */
export function byTerm(): { term: I18nText; sort: number; courses: Course[] }[] {
  const map = new Map<number, { term: I18nText; sort: number; courses: Course[] }>();
  for (const c of COURSES) {
    if (!map.has(c.sort)) map.set(c.sort, { term: c.term, sort: c.sort, courses: [] });
    map.get(c.sort)!.courses.push(c);
  }
  return [...map.values()].sort((a, b) => b.sort - a.sort);
}
