import { useRef, useState } from 'react';
import { useTrafficSim, type PlatoonMode, type TrafficMetrics } from '../hooks/useTrafficSim';
import { usePrefersReducedMotion } from '../hooks/usePrefersReducedMotion';
import HudFrame from './HudFrame';
import { SIM_LEGEND, type SimScenario } from '../data/research';
import { DISPATCH, PLATOON, RING, V2V } from '../lib/scenarios';
import { pick, type Lang } from '../i18n';
import type { I18nText } from '../i18n/types';
import s from './TrafficSim.module.css';

/**
 * TrafficSim — 연구분야 옆에 붙는 실제 IDM 교통 시뮬레이션.
 *
 * 물리는 `src/lib/idm.ts`, 설정은 `src/lib/scenarios.ts`, 렌더링은 `useTrafficSim`.
 * 이 컴포넌트는 `<canvas ref>` 와 HUD 마크업, 그리고 토글만 갖는다.
 *
 * 계측값은 React state 를 거치지 않는다 — 훅이 프레임 안에서 `onMetrics` 로 넘겨주면
 * ref 로 잡아 둔 `<span>` 에 textContent 로 직접 찍는다. 리렌더 0회.
 * state 는 시나리오 토글(모드·AV 대수)에만 쓴다.
 *
 * **크롬의 규칙**(2026-09, 교수님 "너무 AI 스럽다"에 대한 답):
 *   · 제목 위의 눈썹줄 없음 — `SIM · SHOCKWAVE` 는 내부 키를 화면에 노출했다.
 *   · 라벨·상태·구성 표기는 **문장 케이스, 자간 0**. 대문자 + 자간은 버튼(.ctrl)만.
 *   · 수치는 한 줄 텔레메트리다 — 큰 숫자 4칸은 히어로 메트릭 템플릿이다.
 *   · 상태줄은 사람 말이고 표시등은 글리프가 아니라 CSS 로 그린 사각 틱이다.
 */

export interface TrafficSimProps {
  scenario: SimScenario;
  lang: Lang;
  /**
   * 홈 무대용 간결 모드. 계측기가 무엇을 보여주는지 적는 한 줄과 구성 표기를 감춘다 —
   * 연구 페이지에서는 설정을 밝히는 것이 계측의 예의지만, 홈의 한 화면에는
   * 번호·이름·키워드·시뮬레이션 넷만 둔다(그 옆의 문장은 설명문으로 읽힌다).
   */
  compact?: boolean;
}

interface Readout {
  key: string;
  label: I18nText;
  /** 단위는 SI 표기 그대로다 — `M/S` 가 아니라 `m/s`. */
  unit?: string;
  /**
   * 사이클(또는 측정 창) 전체를 모아야 뜻이 생기는 값.
   * 확정 전에는 흐리게 찍어 옆의 실시간 값과 구분한다.
   */
  provisional?: boolean;
}

const READOUTS: Record<SimScenario, Readout[]> = {
  platoon: [
    { key: 'amp', label: { en: 'Amplification', ko: '증폭률' }, unit: '×' },
    { key: 'lead', label: { en: 'Lead drop', ko: '선두 감속' }, unit: 'km/h' },
    { key: 'rear', label: { en: 'Rear drop', ko: '후미 감속' }, unit: 'km/h', provisional: true },
    { key: 'spread', label: { en: 'Speed spread', ko: '속도 편차' }, unit: 'm/s' },
  ],
  shockwave: [
    { key: 'spread', label: { en: 'Speed spread', ko: '속도 편차' }, unit: 'm/s' },
    { key: 'reduction', label: { en: 'vs no AV', ko: '자율차 없을 때 대비' }, unit: '%', provisional: true },
    { key: 'band', label: { en: 'Speed band', ko: '속도 범위' }, unit: 'km/h' },
    { key: 'av', label: { en: 'Automated', ko: '자율주행차' } },
  ],
  dispatch: [
    { key: 'assigned', label: { en: 'Dispatched', ko: '배차' } },
    { key: 'served', label: { en: 'Trips served', ko: '운행 완료' } },
    { key: 'wait', label: { en: 'Mean wait', ko: '평균 대기' }, unit: 's' },
    { key: 'mean', label: { en: 'Fleet speed', ko: '평균 속도' }, unit: 'km/h' },
  ],
  v2v: [
    { key: 'links', label: { en: 'Active links', ko: '연결된 링크' } },
    { key: 'merges', label: { en: 'Merges', ko: '합류' } },
    { key: 'range', label: { en: 'Link range', ko: '통신 범위' }, unit: 'm' },
    { key: 'mean', label: { en: 'Mean speed', ko: '평균 속도' }, unit: 'km/h' },
  ],
};

/**
 * 구성 표기 — 연구 페이지에만 붙는다. 약어 대문자 나열(`22 VEH · RING 400 M`)이
 * 아니라 **한 줄짜리 문장**이다. 숫자와 단위만 모노로 남는다.
 */
const SETUP: Record<SimScenario, I18nText> = {
  platoon: {
    en: `${PLATOON.count} vehicles · lead brake ${String(PLATOON.perturb.accel).replace('-', '−')} m/s² for ${PLATOON.perturb.duration} s · ${PLATOON.cycle} s cycle`,
    ko: `차량 ${PLATOON.count}대 · 선두 제동 ${String(PLATOON.perturb.accel).replace('-', '−')} m/s² 로 ${PLATOON.perturb.duration}초 · ${PLATOON.cycle}초 주기`,
  },
  shockwave: {
    en: `${RING.count} vehicles on a ${RING.length} m ring · FollowerStopper automated vehicles`,
    ko: `${RING.length} m 링 도로 위의 차량 ${RING.count}대 · FollowerStopper 자율주행차`,
  },
  dispatch: {
    en: `${DISPATCH.count} vehicles on a ${DISPATCH.cols}×${DISPATCH.rows} grid of streets · ${DISPATCH.length} m of road`,
    ko: `${DISPATCH.cols}×${DISPATCH.rows} 격자 도로망 ${DISPATCH.length} m · 차량 ${DISPATCH.count}대`,
  },
  v2v: {
    en: `${V2V.count} vehicles · link range ${V2V.range} m · merge at ${V2V.mergeAt} m`,
    ko: `차량 ${V2V.count}대 · 통신 범위 ${V2V.range} m · ${V2V.mergeAt} m 지점에서 합류`,
  },
};

const MODES: { key: PlatoonMode; label: string }[] = [
  { key: 'human', label: PLATOON.modes.human.label },
  { key: 'acc', label: PLATOON.modes.acc.label },
  { key: 'controlled', label: PLATOON.modes.controlled.label },
];

const AV_COUNTS = Array.from({ length: RING.avMax + 1 }, (_, i) => i);

/** 읽힌 값이 없다는 표기. */
const NO_READ = '—';

/** NaN 은 계측 전이라는 뜻이다 — 0 으로 속이지 않는다. */
const num = (v: number, d = 1): string => (Number.isFinite(v) ? v.toFixed(d) : NO_READ);

/** 기준값 대비 증감률. 0 에는 부호를 붙이지 않는다(−0% 같은 표기를 막는다). */
const signed = (v: number): string => {
  if (!Number.isFinite(v)) return '—';
  const n = Math.round(v);
  return n === 0 ? '0' : `${n > 0 ? '−' : '+'}${Math.abs(n)}`;
};

/* --- 상태줄 문구 — 장비 용어가 아니라 사람 말이다 ------------------------ */

const settledAt = (t: number): I18nText => ({
  en: `Settled at t+${t} s`,
  ko: `t+${t}초에 안정됨`,
});

const settling = (now: number, win: number): I18nText => ({
  en: `Settling · ${now} of ${win} s in the two-lap window`,
  ko: `안정화 중 · 두 바퀴 측정 창 ${win}초 가운데 ${now}초`,
});

const measuring = (veh: number, total: number, lastAmp: number): I18nText => {
  const last = Number.isFinite(lastAmp) ? lastAmp.toFixed(2) : null;
  return {
    en:
      `Measuring · the wave has reached ${veh} of ${total} cars` +
      (last ? ` · last cycle ${last}×` : ''),
    ko:
      `측정 중 · 파동이 ${total}대 가운데 ${veh}대째까지` + (last ? ` · 직전 주기 ${last}×` : ''),
  };
};

export default function TrafficSim({ scenario, lang, compact = false }: TrafficSimProps) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const cells = useRef<Record<string, HTMLSpanElement | null>>({});
  const hudRef = useRef<HTMLDListElement>(null);
  const stateRef = useRef<HTMLParagraphElement>(null);
  const stateTextRef = useRef<HTMLSpanElement>(null);
  const reducedMotion = usePrefersReducedMotion();

  const [mode, setMode] = useState<PlatoonMode>(PLATOON.defaultMode);
  const [avCount, setAvCount] = useState<number>(RING.defaultAV);

  const put = (key: string, text: string): void => {
    const el = cells.current[key];
    if (el && el.textContent !== text) el.textContent = text;
  };

  /**
   * 측정 상태를 찍는다. `data-state` 는 CSS 가 읽어 확정 전의 값을 흐리게 만들고
   * 표시등의 사각 틱을 채운다. 여기도 textContent 직접 쓰기다 — rAF 안에서
   * setState 하지 않는다.
   */
  const putState = (settled: boolean, text: I18nText): void => {
    const state = settled ? 'settled' : 'measuring';
    const dl = hudRef.current;
    if (dl && dl.dataset.state !== state) dl.dataset.state = state;
    const el = stateRef.current;
    if (el && el.dataset.state !== state) el.dataset.state = state;
    const txt = stateTextRef.current;
    const next = pick(text, lang);
    if (txt && txt.textContent !== next) txt.textContent = next;
  };

  const onMetrics = (m: TrafficMetrics): void => {
    if (m.scenario === 'platoon') {
      // 확정 전에는 증폭률 자리를 비운다. 과도구간의 값은 아직 교란이 후미에
      // 닿지 않아서 작을 뿐인데, 그대로 찍으면 사람이 제어AV 보다 나아 보인다.
      put('amp', m.settled ? num(m.amp, 2) : NO_READ);
      put('lead', num(m.leadDropKmh));
      put('rear', num(m.rearDropKmh));
      put('spread', num(m.spread, 2));
      putState(
        m.settled,
        m.settled
          ? settledAt(Math.round(m.settledAtS))
          : measuring(m.waveVeh, PLATOON.count, m.lastAmp),
      );
    } else if (m.scenario === 'shockwave') {
      put('spread', num(m.spread, 2));
      put('reduction', signed(m.reductionPct));
      put('band', `${Math.round(m.minKmh)}–${Math.round(m.maxKmh)}`);
      put('av', `${m.avCount}/${RING.count}`);
      putState(
        m.settled,
        m.settled
          ? settledAt(Math.round(m.settledAtS))
          : settling(Math.round(Math.min(m.t, m.windowS)), Math.round(m.windowS)),
      );
    } else if (m.scenario === 'dispatch') {
      put('assigned', `${m.assigned}/${DISPATCH.count}`);
      put('served', String(m.served));
      put('wait', num(m.meanWaitS));
      put('mean', num(m.meanKmh, 0));
    } else {
      put('links', String(m.links));
      put('merges', String(m.merges));
      put('range', String(V2V.range));
      put('mean', num(m.meanKmh, 0));
    }
  };

  useTrafficSim(canvasRef, {
    scenario,
    mode,
    avCount,
    target: wrapRef,
    reducedMotion,
    onMetrics,
  });

  const legend = SIM_LEGEND[scenario];
  const axis = legend.axis ? pick(legend.axis, lang) : undefined;
  const hasToggles = scenario === 'platoon' || scenario === 'shockwave';

  return (
    <div ref={wrapRef} className={s.wrap}>
      {/*
        눈썹줄(`SIM · SHOCKWAVE`)이 이 틀 위에 앉아 있었다. 제목 위의 작은 라벨은
        AI 가 만든 화면의 첫 번째 표식이고, 게다가 내부 시나리오 키를 그대로
        화면에 내보이고 있었다. 코너 틱과 헤어라인은 이 사이트의 카드 어휘라 남긴다.
      */}
      <HudFrame
        edges={['top', 'left']}
        ticks
        className={[s.frame, compact ? s.compact : ''].filter(Boolean).join(' ')}
      >
        {compact && !hasToggles ? null : (
          <div className={s.head}>
            {compact ? null : <p className={s.readout}>{pick(legend.readout, lang)}</p>}

            {hasToggles ? (
              <div className={s.controls} role="group" aria-label={axis}>
                {compact || !axis ? null : (
                  <span className={s.axis} aria-hidden="true">
                    {axis}
                  </span>
                )}
                {scenario === 'platoon'
                  ? MODES.map((m) => (
                      <button
                        key={m.key}
                        type="button"
                        className={s.ctrl}
                        aria-pressed={mode === m.key}
                        onClick={() => setMode(m.key)}
                      >
                        <span className={s.caret} aria-hidden="true">
                          ▸
                        </span>
                        {m.label}
                      </button>
                    ))
                  : AV_COUNTS.map((n) => (
                      <button
                        key={n}
                        type="button"
                        className={s.ctrl}
                        aria-pressed={avCount === n}
                        aria-label={`${n} AV`}
                        onClick={() => setAvCount(n)}
                      >
                        <span className={s.caret} aria-hidden="true">
                          ▸
                        </span>
                        {`AV ${n}`}
                      </button>
                    ))}
              </div>
            ) : null}
          </div>
        )}

        <canvas ref={canvasRef} className={s.canvas} aria-hidden="true" />

        {/* 모드·AV 대수를 바꾸면 측정이 처음부터 다시 시작한다. key 를 갈아 끼워
            수치판을 통째로 새로 마운트하면 이전 측정의 숫자가 한 프레임도 남지 않는다. */}
        <div className={s.readings} key={`${scenario}:${mode}:${avCount}`}>
          {/* 계측기 한 줄. 큰 숫자 카드 4칸이었던 자리다 — 결론값(첫 항목)은
              크기가 아니라 굵기로 한 단계만 선다. */}
          <dl className={s.hud} ref={hudRef} data-sim={scenario} data-state="measuring">
            {READOUTS[scenario].map((r, i) => (
              <div
                key={r.key}
                className={[s.cell, i === 0 ? s.cellLead : '', r.provisional ? s.provisional : '']
                  .filter(Boolean)
                  .join(' ')}
              >
                <dt className={s.cellLabel}>{pick(r.label, lang)}</dt>
                <dd className={s.cellValue}>
                  <span
                    className={s.figure}
                    ref={(el) => {
                      cells.current[r.key] = el;
                    }}
                  >
                    —
                  </span>
                  {r.unit ? (
                    <span className={s.unit} aria-hidden="true">
                      {r.unit}
                    </span>
                  ) : null}
                </dd>
              </div>
            ))}
          </dl>

          {/* 측정 상태 — 확정 전의 숫자를 확정값으로 읽지 않게 하는 표시등.
              표시등은 유니코드 글리프가 아니라 CSS 로 그린 사각 틱이다(하드 룰 7).
              03·04 는 확정을 기다리는 결론값이 없어 이 줄이 없다. */}
          {hasToggles ? (
            <p className={s.state} ref={stateRef} data-state="measuring">
              <span ref={stateTextRef}>{lang === 'ko' ? '측정 중' : 'Measuring'}</span>
            </p>
          ) : null}
        </div>

        {compact ? null : <p className={s.setup}>{pick(SETUP[scenario], lang)}</p>}
      </HudFrame>
    </div>
  );
}
