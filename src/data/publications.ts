/**
 * 논문 목록.
 *
 * 서지정보는 번역하지 않는다 — 저자·제목·학술지명은 양쪽 로케일에서 동일하게 나온다.
 * 새 논문은 배열 맨 앞에 한 항목 추가하면 된다 (연도 내림차순 정렬).
 */

export type PubKind = 'journal' | 'conference';

export interface Publication {
  kind: PubKind;
  year: number;
  authors: string[];
  title: string;
  /** 학술지명 또는 학술대회명. */
  venue: string;
  /** `173`, `2673(9)` 등. */
  volume?: string;
  pages?: string;
  doi?: string;
  url?: string;
}

export const PUBLICATIONS: Publication[] = [
  {
    kind: 'journal',
    year: 2025,
    authors: ['Yu, H.', 'Yeo, H.'],
    title:
      'Traffic control policies for minimizing the negative effect of Adaptive Cruise Control on highway',
    venue: 'Transportation Research Part C: Emerging Technologies',
    volume: '173',
    pages: '105063',
  },
  {
    kind: 'journal',
    year: 2025,
    authors: ['Yu, H.', 'Yeo, H.'],
    title:
      'Dynamic Characteristics of Commercial Adaptive Cruise Control across Driving Situations: Response Time, String Stability, and Asymmetric Behavior',
    venue: 'Transportation Research Part C: Emerging Technologies',
    volume: '170',
    pages: '104931',
  },
  {
    kind: 'journal',
    year: 2025,
    authors: ['Yu, H.', 'Yeo, H.'],
    title: 'Impact of commercial adaptive cruise control on highway traffic congestion and safety',
    venue: 'Transportmetrica B: Transport Dynamics',
    volume: '13(1)',
    pages: '2519630',
  },
  {
    kind: 'journal',
    year: 2022,
    authors: ['Tak, S.', 'Kim, S.', 'Yu, H.', 'Lee, D.'],
    title:
      'Analysis of relationship between road geometry and automated driving safety for automated vehicle-based mobility service',
    venue: 'Sustainability',
    volume: '14(4)',
    pages: '2336',
  },
  {
    kind: 'journal',
    year: 2021,
    authors: ['Kim, S.', 'Yu, H.', 'Yeo, H.'],
    title:
      'A study on travel time estimation of diverging traffic stream on highways based on timestamp data',
    venue: 'Journal of Advanced Transportation',
    volume: '2021',
    pages: '1–13',
  },
  {
    kind: 'journal',
    year: 2019,
    authors: ['Yu, H.', 'Tak, S.', 'Park, M.', 'Yeo, H.'],
    title: 'Impact of autonomous-vehicle-only lanes in mixed traffic conditions',
    venue: 'Transportation Research Record',
    volume: '2673(9)',
    pages: '430–439',
  },

  {
    kind: 'conference',
    year: 2024,
    authors: [],
    title: 'Impact of Adaptive Cruise Control on Highway Traffic Breakdown and Ramp Metering',
    venue: 'Transportation Research Board',
  },
  {
    kind: 'conference',
    year: 2023,
    authors: [],
    title:
      'Prioritized Phase Split Optimization for Coordinated Traffic Signal Control in Urban Network Using Deep Reinforcement Learning',
    venue: 'IEEE International Conference on Intelligent Transportation Systems',
  },
  {
    kind: 'conference',
    year: 2020,
    authors: [],
    title:
      'A Framework for Travel Time Estimation of Diverging Traffic Stream in Highways based on Timestamp Data',
    venue: 'Transportation Research Board',
  },
  {
    kind: 'conference',
    year: 2019,
    authors: [],
    title:
      'Real-time Prediction of Arterial Vehicle Trajectories: An Application to Predictive Route Guidance for an Emergency Vehicle',
    venue: 'IEEE International Conference on Intelligent Transportation Systems',
  },
  {
    kind: 'conference',
    year: 2019,
    authors: [],
    title: 'Impact of autonomous-vehicle-only lanes in mixed traffic conditions',
    venue: 'Transportation Research Board',
  },
];

export const byKind = (kind: PubKind): Publication[] =>
  PUBLICATIONS.filter((p) => p.kind === kind).sort((a, b) => b.year - a.year);

export const years = (): number[] =>
  [...new Set(PUBLICATIONS.map((p) => p.year))].sort((a, b) => b - a);

/** 축약 서지 — `TR-C 173, 105063` 형태. 텔레메트리 로그 행에 쓴다. */
export function citation(p: Publication): string {
  return [p.venue, [p.volume, p.pages].filter(Boolean).join(', ')].filter(Boolean).join(' · ');
}
