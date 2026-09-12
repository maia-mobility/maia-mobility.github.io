import type { I18nText } from '../i18n/types';

export type NewsKind = 'grant' | 'lab' | 'award' | 'paper' | 'talk';

export interface NewsItem {
  /** ISO 8601. 표시 형식은 로케일이 정한다. */
  date: string;
  kind: NewsKind;
  title: I18nText;
  body?: I18nText;
}

/** 최신순. 새 소식은 맨 앞에 추가. */
export const NEWS: NewsItem[] = [
  {
    date: '2026-08-25',
    kind: 'grant',
    title: {
      en: 'Dr. Hwapyeong Yu has been selected for the Individual Basic Research Program funded by the National Research Foundation (NRF).',
      ko: '유화평 교수가 한국연구재단(NRF) 개인기초연구사업에 선정되었습니다.',
    },
    body: {
      en: 'The project focuses on AI-driven traffic management systems and runs from September 2026 through August 2029.',
      ko: 'AI 기반 교통관리 시스템을 주제로 하며, 2026년 9월부터 2029년 8월까지 수행합니다.',
    },
  },
  {
    date: '2026-03-01',
    kind: 'lab',
    title: {
      en: 'Dr. Hwapyeong Yu has joined Myongji University as an Assistant Professor in the Smart Mobility Engineering Major and has established the MAIA Lab.',
      ko: '유화평 교수가 명지대학교 스마트모빌리티공학전공 조교수로 부임하여 MAIA 연구실을 설립했습니다.',
    },
  },
];

/** 뉴스 종류 라벨 — 모노 칩으로 렌더. */
export const NEWS_KIND_LABEL: Record<NewsKind, I18nText> = {
  grant: { en: 'GRANT', ko: '연구과제' },
  lab: { en: 'LAB', ko: '연구실' },
  award: { en: 'AWARD', ko: '수상' },
  paper: { en: 'PAPER', ko: '논문' },
  talk: { en: 'TALK', ko: '발표' },
};

/** `2026.08.25` (ko) / `Aug 25, 2026` (en). */
export function formatDate(iso: string, lang: 'en' | 'ko'): string {
  const d = new Date(`${iso}T00:00:00Z`);
  if (lang === 'ko') {
    const p = iso.split('-');
    return `${p[0]}.${p[1]}.${p[2]}`;
  }
  return d.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  });
}
