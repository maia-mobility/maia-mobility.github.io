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
  /** 관심 주제 — 학생은 연구분야 id 가 아니라 제 말로 적는다. 명단에 낱말 줄로 선다. */
  topics?: I18nText[];
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
 * 연구실은 2026년 3월 개설. 첫 학부연구생 셋(2026.09). 사진은 `pic/` 의 원본을
 * `scripts/fit-portrait.py` 로 교수님 사진과 같은 얼굴 폭·눈높이의 3:4 틀에 맞춘
 * 사본이다 — 원본을 그대로 넣지 마라(프레임·얼굴 크기가 제각각이라 명단이 아니라
 * 짜깁기로 보인다). 관심 주제는 학생과 상의한 문안이 아니라 연구실 분야에 맞춰 둔
 * 초안이다 — 학생이 정하면 여기서 고친다.
 */
/** 학부연구생 공통 직함. 학생이 더 생기면 같은 값을 쓴다. */
const UNDERGRAD: I18nText = { en: 'Undergraduate Researcher', ko: '학부연구생' };

export const MEMBERS: Person[] = [
  {
    id: 'lee-seyeon',
    name: { en: 'Lee Seyeon', ko: '이세연' },
    latin: 'Lee, S.',
    role: UNDERGRAD,
    photo: '/images/people/lee-seyeon.jpg',
    topics: [
      { en: 'Traffic simulation', ko: '교통 시뮬레이션' },
      { en: 'Mixed autonomy traffic', ko: '자율주행 혼합교통' },
      { en: 'Data-driven traffic analysis', ko: '교통 데이터 분석' },
    ],
  },
  {
    id: 'jo-sungpil',
    name: { en: 'Jo Sungpil', ko: '조성필' },
    latin: 'Jo, S.',
    role: UNDERGRAD,
    photo: '/images/people/jo-sungpil.jpg',
    topics: [
      { en: 'Reinforcement learning for signal control', ko: '강화학습 기반 신호 제어' },
      { en: 'Ramp metering', ko: '램프 미터링' },
      { en: 'Deep learning', ko: '딥러닝' },
    ],
  },
  {
    id: 'choi-woojin',
    name: { en: 'Choi Woojin', ko: '최우진' },
    latin: 'Choi, W.',
    role: UNDERGRAD,
    photo: '/images/people/choi-woojin.jpg',
    topics: [
      { en: 'Connected vehicles (V2X)', ko: 'V2X 커넥티드 차량' },
      { en: 'Cooperative driving', ko: '협력 주행' },
      { en: 'Vehicle trajectory data', ko: '차량 궤적 데이터' },
    ],
  },
];

export const ALUMNI: Person[] = [];

/** 논문 저자명 하이라이트용 — 이 이름들은 Publications 목록에서 강조된다. */
export const LAB_AUTHORS: string[] = [PI.latin, mono('Yu, Hwapyeong').en];
