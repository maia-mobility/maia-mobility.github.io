import { mono, type I18nText } from '../i18n/types';

export interface CVEntry {
  /** `2019–2024`, `2026.03~` 등. 로케일 무관. */
  period: string;
  role: I18nText;
  org: I18nText;
  detail?: I18nText;
  advisor?: string;
}

export interface Person {
  id: string;
  name: I18nText;
  /** 로마자 표기 — 논문 저자명과 대조하기 위해. */
  latin: string;
  role: I18nText;
  since?: string;
  affiliation?: I18nText;
  email?: string;
  photo?: string;
  education?: CVEntry[];
  experience?: CVEntry[];
  /** 연구 관심사 — research.ts 의 id 를 참조. */
  interests?: string[];
}

export const PI: Person = {
  id: 'hwapyeong-yu',
  name: { en: 'Hwapyeong Yu', ko: '유화평' },
  latin: 'Yu, H.',
  role: { en: 'Assistant Professor', ko: '조교수' },
  since: '2026.03~',
  affiliation: {
    en: 'Smart Mobility Engineering Major, Division of Smart Infrastructure Engineering, Myongji University',
    ko: '명지대학교 스마트인프라공학부 스마트모빌리티공학전공',
  },
  email: 'yupeace@mju.ac.kr',
  photo: '/images/pi.jpg',
  interests: ['av-control', 'mixed-traffic', 'mobility-service', 'cav-cda'],
  education: [
    {
      period: '2019–2024',
      role: { en: 'Ph.D.', ko: '박사' },
      org: {
        en: 'KAIST, Civil and Environmental Engineering',
        ko: 'KAIST 건설및환경공학과',
      },
      detail: {
        en: 'Dissertation on autonomous vehicle characteristics and control policies',
        ko: '학위논문: 자율주행차의 특성 및 제어 정책',
      },
      advisor: 'Hwasoo Yeo',
    },
    {
      period: '2017–2019',
      role: { en: 'M.S.', ko: '석사' },
      org: {
        en: 'KAIST, Civil and Environmental Engineering',
        ko: 'KAIST 건설및환경공학과',
      },
      detail: {
        en: 'Dissertation on dedicated autonomous vehicle lanes',
        ko: '학위논문: 자율주행차 전용차로',
      },
      advisor: 'Hwasoo Yeo',
    },
    {
      period: '2012–2016',
      role: { en: 'B.S.', ko: '학사' },
      org: {
        en: 'KAIST, Civil and Environmental Engineering',
        ko: 'KAIST 건설및환경공학과',
      },
      detail: {
        en: 'Minor in Industrial Engineering · cum laude',
        ko: '산업및시스템공학 부전공 · 우등 졸업 (cum laude)',
      },
    },
  ],
  experience: [
    {
      period: '2025.03–2026.02',
      role: { en: 'Postdoctoral Associate', ko: '박사후연구원' },
      org: {
        en: 'University of Minnesota, Dept. of Civil, Environmental, and Geo-Engineering',
        ko: 'University of Minnesota 토목·환경·지반공학과',
      },
      detail: {
        en: 'Research on autonomous driving and traffic control',
        ko: '자율주행 및 교통 제어 연구',
      },
      advisor: 'Raphael Stern',
    },
    {
      period: '2024.09–2025.02',
      role: { en: 'Postdoctoral Researcher', ko: '박사후연구원' },
      org: { en: 'KAIST', ko: 'KAIST' },
    },
  ],
};

/**
 * 연구실은 2026년 3월 개설. 기존 사이트에 학생 명단이 없어 비어 있다.
 * 구성원이 생기면 여기에 추가하면 People 페이지에 자동으로 렌더된다.
 */
export const MEMBERS: Person[] = [];

export const ALUMNI: Person[] = [];

/** 논문 저자명 하이라이트용 — 이 이름들은 Publications 목록에서 강조된다. */
export const LAB_AUTHORS: string[] = [PI.latin, mono('Yu, Hwapyeong').en];
