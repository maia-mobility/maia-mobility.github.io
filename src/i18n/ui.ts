import type { I18nText, Lang } from './types';

/** 내비게이션. `key` 는 로케일 무관 라우트 키(i18n/index.ts 의 routeKey 와 짝). */
export interface NavItem {
  key: string;
  label: I18nText;
  /** 섹션 번호 — HUD 스타일 `01 / 02 …` 표기에 쓴다. */
  index: string;
}

export const NAV: NavItem[] = [
  { key: '', label: { en: 'Home', ko: '홈' }, index: '00' },
  { key: 'research', label: { en: 'Research', ko: '연구' }, index: '01' },
  { key: 'people', label: { en: 'People', ko: '구성원' }, index: '02' },
  { key: 'publications', label: { en: 'Publications', ko: '논문' }, index: '03' },
  { key: 'teaching', label: { en: 'Teaching', ko: '강의' }, index: '04' },
  { key: 'news', label: { en: 'News', ko: '소식' }, index: '05' },
];

/** 페이지별 <title> / meta description. */
export const META: Record<string, { title: I18nText; description: I18nText }> = {
  '': {
    title: { en: 'MAIA Lab', ko: 'MAIA 연구실' },
    description: {
      en: 'MAIA Lab at Myongji University — data-driven, AI-powered, and autonomous mobility systems for safer and more efficient transportation networks.',
      ko: '명지대학교 MAIA 연구실 — 데이터 기반·AI·자율주행 모빌리티 시스템으로 더 안전하고 효율적인 교통 네트워크를 연구합니다.',
    },
  },
  research: {
    title: { en: 'Research', ko: '연구 분야' },
    description: {
      en: 'Four research directions: AV control and behavior, mixed traffic control with AI, AV mobility service, and cooperative driving automation.',
      ko: '자율주행차 제어·거동, AI 기반 혼합교통 제어, 자율주행 모빌리티 서비스, 협력주행 자동화 — 네 가지 연구 방향.',
    },
  },
  people: {
    title: { en: 'People', ko: '구성원' },
    description: {
      en: 'Members of MAIA Lab, led by Prof. Hwapyeong Yu at Myongji University.',
      ko: '명지대학교 MAIA 연구실 구성원 — 지도교수 유화평.',
    },
  },
  publications: {
    title: { en: 'Publications', ko: '논문' },
    description: {
      en: 'Peer-reviewed journal articles and conference papers from MAIA Lab.',
      ko: 'MAIA 연구실의 국제 저널 논문 및 학술대회 발표 목록.',
    },
  },
  teaching: {
    title: { en: 'Teaching', ko: '강의' },
    description: {
      en: 'Courses taught by Prof. Hwapyeong Yu at Myongji University.',
      ko: '명지대학교에서 유화평 교수가 담당하는 강의 목록.',
    },
  },
  news: {
    title: { en: 'News', ko: '소식' },
    description: {
      en: 'Announcements, grants, and milestones from MAIA Lab.',
      ko: 'MAIA 연구실의 공지, 연구과제 선정, 주요 소식.',
    },
  },
  404: {
    title: { en: 'Signal Lost', ko: '신호 유실' },
    description: { en: 'Page not found.', ko: '페이지를 찾을 수 없습니다.' },
  },
};

/** 공용 UI 문구. */
export const UI = {
  skipToContent: { en: 'Skip to content', ko: '본문으로 건너뛰기' },
  menu: { en: 'Menu', ko: '메뉴' },
  close: { en: 'Close', ko: '닫기' },
  scroll: { en: 'Scroll', ko: '스크롤' },
  /** 연구 덱의 이전/다음 — 가로로 넘긴다는 것을 알려주는 유일한 장치다. */
  prevArea: { en: 'Previous area', ko: '이전 분야' },
  nextArea: { en: 'Next area', ko: '다음 분야' },

  /** 홈의 요약 구역에서 전체 목록 페이지로 가는 링크. */
  seeAll: { en: 'See all', ko: '전체 보기' },

  // 섹션 헤더
  sectionMission: { en: 'Mission', ko: '연구 방향' },
  sectionResearch: { en: 'Research', ko: '연구 분야' },
  sectionPeople: { en: 'People', ko: '구성원' },
  sectionNews: { en: 'News', ko: '소식' },
  sectionJoin: { en: 'Join Us', ko: '함께하기' },
  sectionContact: { en: 'Contact', ko: '연락처' },
  sectionPublications: { en: 'Publications', ko: '논문' },
  sectionTeaching: { en: 'Teaching', ko: '강의' },

  // People
  /* 직함 줄에 이어 붙는다(`Assistant Professor · Principal Investigator`).
     한글은 `지도교수` 가 아니라 `연구책임자` 다 — 바로 아래 학력 항목의
     `advisor`(지도교수)와 같은 낱말이면 두 뜻이 한 화면에서 겹친다. */
  principalInvestigator: { en: 'Principal Investigator', ko: '연구책임자' },
  /* 부임 시점. 붙는 자리가 언어마다 달라(`Since 2026.03` / `2026.03 부임`)
     한 낱말만 두고 순서는 쓰는 쪽이 정한다. */
  since: { en: 'Since', ko: '부임' },
  members: { en: 'Members', ko: '연구실 구성원' },
  alumni: { en: 'Alumni', ko: '졸업생' },
  education: { en: 'Education', ko: '학력' },
  experience: { en: 'Experience', ko: '경력' },
  advisor: { en: 'Advisor', ko: '지도교수' },
  /* 빈 구성원 칸의 사실 한 줄. 예전 문안의 둘째 문장("이곳에 연구원들이 소개될
     예정입니다")은 자리를 채우려는 말이지 사실이 아니라 뺐다 — 빈칸을 설명하는
     문장이 곧 AI 가 쓴 표식이다. 모집 안내는 교수님 문안(`SITE.recruiting`)이
     바로 아래에 있다. */
  membersEmpty: {
    en: 'MAIA Lab opened in March 2026 and is recruiting its first members.',
    ko: '2026년 3월에 문을 연 연구실로, 첫 구성원을 모집하고 있습니다.',
  },

  // Publications
  journalArticles: { en: 'Journal Articles', ko: '국제 저널 논문' },
  conferencePapers: { en: 'Conference Papers', ko: '학술대회 발표' },
  all: { en: 'All', ko: '전체' },
  filterByYear: { en: 'Filter by year', ko: '연도별 보기' },

  // Teaching
  undergraduate: { en: 'Undergraduate', ko: '학부' },
  graduate: { en: 'Graduate', ko: '대학원' },

  // 공통 액션
  readMore: { en: 'Read more', ko: '자세히' },
  viewAll: { en: 'View all', ko: '전체 보기' },
  backHome: { en: 'Return to base', ko: '처음으로' },
  emailUs: { en: 'Email us', ko: '메일 보내기' },

  // 404
  notFoundTitle: { en: 'Signal lost', ko: '신호 유실' },
  notFoundBody: {
    en: 'No point returns from this bearing. The page you requested is not in the map.',
    ko: '이 방위에서는 반사되어 돌아오는 점이 없습니다. 요청하신 페이지가 지도에 없습니다.',
  },
} satisfies Record<string, I18nText>;

/** 로케일 토글 라벨. */
export const LANG_LABEL: Record<Lang, string> = { en: 'EN', ko: 'KO' };
