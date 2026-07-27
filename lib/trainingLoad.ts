/**
 * 훈련 부하 모델 (Banister impulse-response)
 * - 세션마다 러닝 rTSS 근사치(시간 × 강도계수² × 100)로 일일 부하를 구하고
 * - CTL(42일 지수평활, 체력) / ATL(7일 지수평활, 피로도) / TSB(CTL−ATL, 폼)를 매일 갱신한다
 * - 강도계수(IF)는 페이스 기준 "임계치 페이스"(하프·10K 경계, classifyIntensity의 템포 경계와 동일)를 기준으로 삼는다
 */

import {
  effectiveTimeSec,
  gradeAdjustedPace,
  parseTime,
  predictAll,
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
  const predictions = predictAll(races, inbody);
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
