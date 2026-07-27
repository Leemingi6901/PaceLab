/**
 * 훈련 부하 모델 (Banister impulse-response)
 * - 세션마다 러닝 rTSS 근사치(시간 × 강도계수² × 100)로 일일 부하를 구하고
 * - CTL(42일 지수평활, 체력) / ATL(7일 지수평활, 피로도) / TSB(CTL−ATL, 폼)를 매일 갱신한다
 * - 강도계수(IF)는 페이스 기준 "임계치 페이스"(하프·10K 경계, classifyIntensity의 템포 경계와 동일)를 기준으로 삼는다
 */

import {
  currentFitness,
  effectiveTimeSec,
  gradeAdjustedPace,
  parseTime,
  predictAll,
  type FitnessSummary,
  type InbodyEntry,
  type RaceRecord,
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
const CTL_FACTOR_CAP = 0.08;

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
 * 비교적 높음), ±4%로 캡을 씌운다. vo2max를 기록한 값이 2개 미만이면 보정하지 않는다.
 */
export function vo2maxTrendFactor(inbody: InbodyEntry[]): number {
  const withVo2 = inbody.filter((m): m is InbodyEntry & { vo2max: number } => typeof m.vo2max === "number");
  if (withVo2.length < 2) return 1;
  const sorted = [...withVo2].sort((a, b) => a.date.localeCompare(b.date));
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

const COMBINED_FACTOR_CAP = 0.12;

/**
 * 대회 기록 기반 VDOT(증명된 체력)에 최근 훈련량(CTL 추이)·체성분·VO2max 변화 추이를
 * 곱해 "현재 추정 체력"을 만든다. 대회를 안 뛰어도 꾸준히 훈련하고 있으면 예측이
 * 조금씩 따라 올라가고, 반대로 훈련 공백이 길어지면 조금씩 내려간다.
 */
export function estimateFitness(
  races: RaceRecord[],
  inbody: InbodyEntry[],
  loadSeries: LoadPoint[]
): EstimatedFitness | null {
  const base = currentFitness(races, inbody);
  if (!base) return null;

  const ctlFactor = ctlTrendFactor(loadSeries);
  const bodyCompFactor = bodyCompTrendFactor(inbody);
  const vo2maxFactor = vo2maxTrendFactor(inbody);
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
