/**
 * 훈련 부하 모델 (Banister impulse-response)
 * - 세션마다 러닝 rTSS 근사치(시간 × 강도계수² × 100)로 일일 부하를 구하고
 * - CTL(42일 지수평활, 체력) / ATL(7일 지수평활, 피로도) / TSB(CTL−ATL, 폼)를 매일 갱신한다
 * - 강도계수(IF)는 페이스 기준 "임계치 페이스"(하프·10K 경계, classifyIntensity의 템포 경계와 동일)를 기준으로 삼는다
 */

import {
  classifyIntensity,
  currentFitness,
  effectiveTimeSec,
  formatPace,
  gapCenteringFraction,
  gradeAdjustedPace,
  hrRangeForZone,
  parseTime,
  predictAll,
  zonePaceBand,
  type FitnessSummary,
  type InbodyEntry,
  type IntensityZone,
  type Prediction,
  type RaceRecord,
  type Vo2maxEntry,
} from "./predict";
import type { Training } from "./store";

const CTL_DAYS = 42;
const ATL_DAYS = 7;

export interface LoadPoint {
  date: string;
  load: number;
  ctl: number;
  atl: number;
  /** 그 날 훈련을 반영하기 전, 전날까지 누적된 값 기준 폼 (그날 훈련 여부 판단에 쓰는 값) */
  tsb: number;
}

export interface LoadSummary {
  ctl: number;
  atl: number;
  tsb: number;
  status: "매우 높은 피로" | "피로 누적" | "균형" | "컨디션 좋음" | "테이퍼 · 완전 회복";
  trend: { date: string; ctl: number; atl: number }[];
}

function dateOnly(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function addDays(dateStr: string, days: number): string {
  const d = new Date(dateStr + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return dateOnly(d);
}

function sessionLoad(timeSec: number, paceSecPerKm: number, thresholdPaceSecPerKm: number): number {
  const intensityFactor = thresholdPaceSecPerKm / paceSecPerKm;
  return (timeSec / 3600) * intensityFactor * intensityFactor * 100;
}

export function buildLoadSeries(races: RaceRecord[], inbody: InbodyEntry[], trainings: Training[]): LoadPoint[] {
  const predictions = predictAll(currentFitness(races, inbody));
  const byLabel = Object.fromEntries(predictions.map((p) => [p.label, p.paceSecPerKm]));
  const thresholdPace = byLabel["하프"] && byLabel["10K"] ? (byLabel["하프"] + byLabel["10K"]) / 2 : undefined;
  if (!thresholdPace) return [];

  const dailyLoad = new Map<string, number>();
  const addLoad = (date: string, amount: number) => dailyLoad.set(date, (dailyLoad.get(date) ?? 0) + amount);

  for (const t of trainings) {
    const timeSec = effectiveTimeSec(parseTime(t.time), t.treadmill);
    const gap = gradeAdjustedPace(timeSec, t.distanceKm, t.elevGainM ?? 0, t.elevLossM ?? 0);
    addLoad(t.date, sessionLoad(timeSec, gap, thresholdPace));
  }
  for (const r of races) {
    const timeSec = parseTime(r.time);
    addLoad(r.date, sessionLoad(timeSec, timeSec / r.distanceKm, thresholdPace));
  }

  if (dailyLoad.size === 0) return [];

  const dates = [...dailyLoad.keys()].sort();
  const todayStr = dateOnly(new Date());
  const startStr = dates[0];
  const endStr = todayStr > dates[dates.length - 1] ? todayStr : dates[dates.length - 1];

  const series: LoadPoint[] = [];
  let ctl = 0;
  let atl = 0;
  let cursor = startStr;
  while (cursor <= endStr) {
    const load = dailyLoad.get(cursor) ?? 0;
    const tsb = ctl - atl;
    ctl += (load - ctl) / CTL_DAYS;
    atl += (load - atl) / ATL_DAYS;
    series.push({ date: cursor, load, ctl, atl, tsb });
    cursor = addDays(cursor, 1);
  }
  return series;
}

export function summarizeLoad(series: LoadPoint[]): LoadSummary | null {
  if (series.length === 0) return null;
  const last = series[series.length - 1];
  const tsb = last.tsb;

  let status: LoadSummary["status"];
  if (tsb <= -25) status = "매우 높은 피로";
  else if (tsb <= -10) status = "피로 누적";
  else if (tsb < 5) status = "균형";
  else if (tsb < 20) status = "컨디션 좋음";
  else status = "테이퍼 · 완전 회복";

  const trend = series.slice(-84).map((p) => ({ date: p.date, ctl: p.ctl, atl: p.atl }));

  return { ctl: last.ctl, atl: last.atl, tsb, status, trend };
}

const CTL_LOOKBACK_DAYS = 84; // 12주 — 한 훈련 사이클
const CTL_SENSITIVITY = 0.4;
export const CTL_FACTOR_CAP = 0.08;

/**
 * 최근 12주 CTL 추이 기반 보정 계수:
 * 지금 CTL이 12주 전보다 높으면(=꾸준히 더 많이/강하게 훈련해왔으면) 체력이 실제로
 * 올라갔을 가능성이 크다고 보고 소폭 상향, 반대로 CTL이 떨어졌으면(훈련 공백·부상 등)
 * 소폭 하향한다. 대회 기록이 없는 기간에도 훈련량 변화를 반영하기 위한 보조 신호이며,
 * 과도한 반응을 막기 위해 민감도를 낮추고(0.4) ±8%로 한 번 더 캡을 씌운다.
 * 데이터가 6주(42일) 미만이면 신뢰도가 낮다고 보고 보정하지 않는다.
 */
export function ctlTrendFactor(series: LoadPoint[]): number {
  if (series.length < 42) return 1;
  const today = series[series.length - 1];
  const lookbackDate = addDays(today.date, -CTL_LOOKBACK_DAYS);
  let past = series[0];
  for (const p of series) {
    if (p.date <= lookbackDate) past = p;
    else break;
  }
  const base = Math.max(past.ctl, 1);
  const raw = (today.ctl / base - 1) * CTL_SENSITIVITY;
  return 1 + Math.max(-CTL_FACTOR_CAP, Math.min(CTL_FACTOR_CAP, raw));
}

const BODY_COMP_LOOKBACK_DAYS = 90;
const BODY_COMP_FACTOR_CAP = 0.05;

/**
 * 최근 ~90일 체지방률·골격근량 변화 기반 보정 계수:
 * 체중이 그대로여도 체지방이 빠지고 골격근이 늘면 파워/체중비는 실제로 개선된다.
 * (체중 보정만으로는 못 잡는 부분) 체지방 1%p 감소 ≈ +0.6%, 골격근 1kg 증가 ≈ +0.5%로
 * 근사하고(체성분 변화와 러닝 퍼포먼스 간 경험적 근사치), 합산 후 ±5%로 캡을 씌운다.
 */
export function bodyCompTrendFactor(inbody: InbodyEntry[]): number {
  if (inbody.length < 2) return 1;
  const sorted = [...inbody].sort((a, b) => a.date.localeCompare(b.date));
  const latest = sorted[sorted.length - 1];
  const cutoff = Date.now() - BODY_COMP_LOOKBACK_DAYS * 86400000;

  let base = sorted[0];
  for (const m of sorted) {
    if (new Date(m.date).getTime() <= cutoff) base = m;
    else break;
  }
  if (base === latest) return 1;

  const fatDelta = latest.bodyFatPct - base.bodyFatPct;
  const muscleDelta = latest.muscleKg - base.muscleKg;
  const raw = -fatDelta * 0.006 + muscleDelta * 0.005;
  return 1 + Math.max(-BODY_COMP_FACTOR_CAP, Math.min(BODY_COMP_FACTOR_CAP, raw));
}

const VO2MAX_FACTOR_CAP = 0.04;

/**
 * 워치·기기로 측정한 VO2max의 ~90일 추이 기반 보정 계수:
 * 대회 기록과 별개로, 워치가 꾸준히 VO2max 상승을 감지했다면 체력이 실제로 올랐을
 * 가능성이 높다고 보고 반영한다. VO2max 변화율을 그대로 곱하되(측정치라 신뢰도가
 * 비교적 높음), ±4%로 캡을 씌운다. 기록된 값이 2개 미만이면 보정하지 않는다.
 */
export function vo2maxTrendFactor(entries: Vo2maxEntry[]): number {
  if (entries.length < 2) return 1;
  const sorted = [...entries].sort((a, b) => a.date.localeCompare(b.date));
  const latest = sorted[sorted.length - 1];
  const cutoff = Date.now() - BODY_COMP_LOOKBACK_DAYS * 86400000;

  let base = sorted[0];
  for (const m of sorted) {
    if (new Date(m.date).getTime() <= cutoff) base = m;
    else break;
  }
  if (base === latest || base.vo2max <= 0) return 1;

  const raw = latest.vo2max / base.vo2max - 1;
  return 1 + Math.max(-VO2MAX_FACTOR_CAP, Math.min(VO2MAX_FACTOR_CAP, raw));
}

export interface EstimatedFitness extends FitnessSummary {
  /** 대회 기록만으로 구한 "증명된" VDOT (체중 보정 포함, 훈련량/체성분/VO2max 추이 반영 전) */
  provenVdot: number;
  ctlFactor: number;
  bodyCompFactor: number;
  vo2maxFactor: number;
  /** ctlFactor × bodyCompFactor × vo2maxFactor (한 번 더 ±12%로 캡) */
  combinedFactor: number;
}

export const COMBINED_FACTOR_CAP = 0.12;

/**
 * 대회 기록 기반 VDOT(증명된 체력)에 최근 훈련량(CTL 추이)·체성분·VO2max 변화 추이를
 * 곱해 "현재 추정 체력"을 만든다. 대회를 안 뛰어도 꾸준히 훈련하고 있으면 예측이
 * 조금씩 따라 올라가고, 반대로 훈련 공백이 길어지면 조금씩 내려간다.
 */
export function estimateFitness(
  races: RaceRecord[],
  inbody: InbodyEntry[],
  loadSeries: LoadPoint[],
  vo2max: Vo2maxEntry[] = []
): EstimatedFitness | null {
  const base = currentFitness(races, inbody);
  if (!base) return null;

  const ctlFactor = ctlTrendFactor(loadSeries);
  const bodyCompFactor = bodyCompTrendFactor(inbody);
  const vo2maxFactor = vo2maxTrendFactor(vo2max);
  const rawCombined = ctlFactor * bodyCompFactor * vo2maxFactor;
  const combinedFactor = Math.max(1 - COMBINED_FACTOR_CAP, Math.min(1 + COMBINED_FACTOR_CAP, rawCombined));

  // 훈련량/체성분/VO2max 보정은 대회 기록만큼 확실하지 않으므로, 보정 폭의 절반만큼 불확실성 범위를 넓힌다
  const uncertaintyPct = Math.min(0.12, base.uncertaintyPct + Math.abs(combinedFactor - 1) * 0.5);

  return {
    ...base,
    provenVdot: base.weightAdjustedVdot,
    weightAdjustedVdot: base.weightAdjustedVdot * combinedFactor,
    uncertaintyPct,
    ctlFactor,
    vo2maxFactor,
    bodyCompFactor,
    combinedFactor,
  };
}

export interface TrainingScore {
  /** 0~100점 */
  score: number;
  zone: IntensityZone;
  /** 부하 타이밍 적합도 (0~60) — 그날 컨디션(TSB)에 이 강도가 맞았는지 */
  loadFitScore: number;
  /** 실행 정확도 (0~40) — 페이스가 존 한가운데를 또렷하게 찍었는지 + 심박이 목표 구간에 맞았는지 */
  executionScore: number;
  /** 세션 당일(훈련 반영 전) TSB. 이력이 부족하면 undefined */
  tsbAtSession?: number;
  /** 심박 데이터로 실행 정확도를 평가했는지 (없으면 페이스만으로 평가) */
  hrEvaluated: boolean;
  /** "왜 이 점수인지" — 사람이 읽는 설명 */
  breakdown: string[];
  /** "다음엔 어떻게 하면 더 높은 점수를 받을지" — 만점이면 칭찬 문구 하나만 */
  suggestions: string[];
}

interface LoadFitBand {
  idealMin: number;
  idealMax: number;
  falloff: number;
  floor: number;
}

/**
 * 강도별 "이상적인 TSB(폼)" 구간. 강도가 높을수록 신선한 컨디션(TSB가 높음)을 요구하고,
 * 그 범위를 벗어날수록(특히 피로한 상태에서 강하게 훈련했을수록) 감점 폭이 커진다.
 */
const LOAD_FIT_BANDS: Partial<Record<IntensityZone, LoadFitBand>> = {
  마라톤: { idealMin: -10, idealMax: 20, falloff: 1.5, floor: 20 },
  템포: { idealMin: -8, idealMax: 22, falloff: 2.5, floor: 12 },
  인터벌: { idealMin: 0, idealMax: 25, falloff: 3, floor: 8 },
  레페티션: { idealMin: 5, idealMax: 25, falloff: 3, floor: 8 },
};

function loadFitScore(zone: IntensityZone, tsb: number | undefined): { score: number; note: string } {
  if (tsb === undefined) {
    return { score: 45, note: "훈련 부하 이력이 아직 짧아 이 항목은 중립 점수를 적용했습니다." };
  }
  if (zone === "이지" || zone === "—") {
    if (tsb < -8) return { score: 60, note: `피로가 쌓인 상태(TSB ${tsb.toFixed(0)})에서 회복 위주로 잘 조절했습니다.` };
    if (tsb > 30) return { score: 45, note: `이미 충분히 회복된 상태(TSB ${tsb.toFixed(0)})라 조금 더 자극을 줘도 좋았을 시점입니다.` };
    return { score: 55, note: `무난한 컨디션(TSB ${tsb.toFixed(0)})에서의 가벼운 훈련입니다.` };
  }
  const band = LOAD_FIT_BANDS[zone]!;
  if (tsb >= band.idealMin && tsb <= band.idealMax) {
    return { score: 60, note: `컨디션(TSB ${tsb.toFixed(0)})이 이 강도를 소화하기 적합한 시점이었습니다.` };
  }
  const dist = tsb < band.idealMin ? band.idealMin - tsb : tsb - band.idealMax;
  const score = Math.max(band.floor, 60 - dist * band.falloff);
  const note =
    tsb < band.idealMin
      ? `피로가 많이 쌓인 상태(TSB ${tsb.toFixed(0)})에서 강도 높은 훈련이라 부담이 컸을 수 있습니다.`
      : `컨디션이 매우 좋은 상태(TSB ${tsb.toFixed(0)})라 이보다 더 강한 자극도 소화할 수 있었을 것 같습니다.`;
  return { score, note };
}

/**
 * 훈련 하나를 현재 체력·컨디션 기준으로 100점 만점 채점한다.
 * - 부하 타이밍 적합도(60점): 그날 TSB(컨디션)에 이 강도가 맞는 선택이었는지 — Banister 모델 기반
 * - 실행 정확도(40점): 고도 보정 페이스(GAP)가 강도 구간 한가운데를 또렷하게 찍었는지(페이스만 있을 때 40점 만점),
 *   심박 기록이 있으면 페이스 25점 + 심박이 목표 구간에 맞았는지 15점으로 나눠 더 정밀하게 평가
 */
export function scoreTraining(
  training: Training,
  predictions: Prediction[],
  loadSeries: LoadPoint[],
  maxHr?: number,
  restHr?: number
): TrainingScore | null {
  if (predictions.length === 0) return null;

  const timeSec = effectiveTimeSec(parseTime(training.time), training.treadmill);
  const gap = gradeAdjustedPace(timeSec, training.distanceKm, training.elevGainM ?? 0, training.elevLossM ?? 0);
  const zone = classifyIntensity(gap, predictions);
  if (zone === "—") return null;

  const point = loadSeries.find((p) => p.date === training.date);
  const tsbAtSession = point?.tsb;
  const { score: loadScore, note: loadNote } = loadFitScore(zone, tsbAtSession);

  const centerFrac = gapCenteringFraction(gap, zone, predictions);
  const band = zonePaceBand(zone, predictions);
  const hrRange = training.avgHr ? hrRangeForZone(zone, maxHr, restHr) : null;

  let executionScore: number;
  let hrFrac: number | null = null;
  const breakdown: string[] = [loadNote];
  if (hrRange && training.avgHr) {
    const { lo, hi } = hrRange;
    if (training.avgHr >= lo && training.avgHr <= hi) hrFrac = 1;
    else {
      const span = hi - lo || 1;
      const dist = training.avgHr < lo ? lo - training.avgHr : training.avgHr - hi;
      hrFrac = Math.max(0, 1 - dist / span);
    }
    executionScore = centerFrac * 25 + hrFrac * 15;
    breakdown.push(
      hrFrac >= 0.9
        ? `심박 ${training.avgHr}bpm — 목표 구간(${Math.round(lo)}~${Math.round(hi)}bpm)에 잘 맞았습니다.`
        : `심박 ${training.avgHr}bpm — 목표 구간(${Math.round(lo)}~${Math.round(hi)}bpm)과 다소 차이가 있었습니다.`
    );
  } else {
    executionScore = centerFrac * 40;
    breakdown.push(
      centerFrac >= 0.7
        ? "페이스가 강도 구간 한가운데를 또렷하게 찍어 깔끔하게 실행됐습니다."
        : "페이스가 강도 구간 경계에 걸쳐 있어 다소 애매하게 실행됐습니다."
    );
  }

  // 다음엔 어떻게 하면 더 높은 점수를 받을지 — 감점이 있었던 항목만 구체적으로 짚어준다
  const suggestions: string[] = [];
  if (tsbAtSession !== undefined && zone !== "이지" && loadScore < 58) {
    const b = LOAD_FIT_BANDS[zone]!;
    if (tsbAtSession < b.idealMin) {
      suggestions.push(
        `이날은 TSB ${tsbAtSession.toFixed(0)}로 피로가 쌓인 상태였습니다. 다음엔 이 강도(${zone}) 훈련을 TSB ${b.idealMin} 이상일 때로 옮기고, 지친 날엔 이지 조깅으로 회복부터 채워보세요.`
      );
    } else {
      suggestions.push(
        `TSB ${tsbAtSession.toFixed(0)}로 컨디션이 아주 좋았던 날입니다. 이 정도로 신선할 땐 한 단계 더 강한 훈련(예: 인터벌)을 시도해도 좋습니다.`
      );
    }
  }
  if (tsbAtSession !== undefined && zone === "이지" && tsbAtSession > 30) {
    suggestions.push(
      `TSB ${tsbAtSession.toFixed(0)}로 완전히 회복된 상태였는데 이지 조깅만 하셨습니다. 이런 날엔 템포런이나 인터벌로 자극을 주면 더 높은 점수를 받을 수 있어요.`
    );
  }
  if (band && centerFrac < 0.75) {
    const centerPace = (band.lo + band.hi) / 2;
    suggestions.push(
      `페이스가 ${zone} 구간 경계 쪽에 걸쳐 있었습니다. 다음엔 ${formatPace(centerPace)}/km 근처를 목표로 더 또렷하게 뛰어보면 실행 점수가 올라갑니다.`
    );
  }
  if (hrRange && training.avgHr && hrFrac !== null && hrFrac < 0.75) {
    const dir = training.avgHr < hrRange.lo ? "조금 더 끌어올릴" : "조금 늦출";
    suggestions.push(
      `심박이 목표 구간(${Math.round(hrRange.lo)}~${Math.round(hrRange.hi)}bpm)을 ${
        training.avgHr < hrRange.lo ? "밑돌았습니다" : "웃돌았습니다"
      }. 페이스를 ${dir} 수 있는지 다음 훈련에서 확인해보세요.`
    );
  }
  if (suggestions.length === 0) {
    suggestions.push("컨디션 타이밍과 실행 모두 훌륭했습니다 — 지금 방식 그대로 유지하세요!");
  }

  const score = Math.round(Math.max(0, Math.min(100, loadScore + executionScore)));
  return {
    score,
    zone,
    loadFitScore: Math.round(loadScore),
    executionScore: Math.round(executionScore),
    tsbAtSession,
    hrEvaluated: Boolean(hrRange && training.avgHr),
    breakdown,
    suggestions,
  };
}

/** trainings 배열 전체를 한 번에 채점해 훈련 id → TrainingScore 맵으로 반환한다 */
export function scoreTrainings(
  trainings: Training[],
  predictions: Prediction[],
  loadSeries: LoadPoint[],
  maxHr?: number,
  restHr?: number
): Map<string, TrainingScore> {
  const map = new Map<string, TrainingScore>();
  for (const t of trainings) {
    const s = scoreTraining(t, predictions, loadSeries, maxHr, restHr);
    if (s) map.set(t.id, s);
  }
  return map;
}
