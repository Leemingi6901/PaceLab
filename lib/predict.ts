/**
 * PB 예측 엔진
 * - Jack Daniels VDOT 공식으로 기록 → 체력 지표(VDOT) 환산
 * - 최근 기록에 가중치를 두고, 인바디 체중 변화로 보정
 * - Riegel/VDOT 기반으로 목표 거리 기록과 구간(스플릿) 예측
 */

export interface RaceRecord {
  race: string;
  date: string;
  distanceKm: number;
  time: string;
  weightKg?: number;
  note?: string;
}

export interface InbodyEntry {
  date: string;
  weightKg: number;
  bodyFatPct: number;
  muscleKg: number;
}

export interface CourseSegment {
  fromKm: number;
  toKm: number;
  elevGain: number;
  elevLoss: number;
}

/** "1:47:20" | "47:30" → 초 */
export function parseTime(t: string): number {
  const parts = t.split(":").map(Number);
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  return parts[0] * 60 + parts[1];
}

/** 초 → "H:MM:SS" 또는 "MM:SS" */
export function formatTime(sec: number): string {
  const s = Math.round(sec);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = s % 60;
  const mm = String(m).padStart(2, "0");
  const sss = String(ss).padStart(2, "0");
  return h > 0 ? `${h}:${mm}:${sss}` : `${m}:${sss}`;
}

/** 초/km → "M'SS\"" 페이스 표기 */
export function formatPace(secPerKm: number): string {
  const m = Math.floor(secPerKm / 60);
  const s = Math.round(secPerKm % 60);
  return `${m}'${String(s).padStart(2, "0")}"`;
}

/** Daniels-Gilbert: 거리(m)·시간(분) → VDOT */
export function vdotFromRace(distanceM: number, timeMin: number): number {
  const v = distanceM / timeMin; // m/min
  const vo2 = -4.6 + 0.182258 * v + 0.000104 * v * v;
  const pctMax = 0.8 + 0.1894393 * Math.exp(-0.012778 * timeMin) + 0.2989558 * Math.exp(-0.1932605 * timeMin);
  return vo2 / pctMax;
}

/** VDOT → 거리(m) 예상 기록(분). 이분 탐색으로 역산 */
export function predictTimeMin(vdot: number, distanceM: number): number {
  let lo = distanceM / 600;
  let hi = distanceM / 100;
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    if (vdotFromRace(distanceM, mid) > vdot) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

export interface FitnessSummary {
  vdot: number;
  baseRace: RaceRecord;
  weightAdjustedVdot: number;
  latestWeight: number;
  baseWeight: number;
}

/**
 * 현재 체력 추정:
 * - 각 대회 기록의 VDOT 계산 후, 최근 기록일수록 큰 가중치(6개월 반감기)
 * - 체중 보정: 상대 VO2max는 체중에 반비례 → vdot × (기록 당시 체중 / 현재 체중), ±5% 캡
 */
export function currentFitness(races: RaceRecord[], inbody: InbodyEntry[]): FitnessSummary {
  const now = Date.now();
  let wSum = 0;
  let vSum = 0;
  let best: { r: RaceRecord; v: number } | null = null;

  for (const r of races) {
    const v = vdotFromRace(r.distanceKm * 1000, parseTime(r.time) / 60);
    const ageDays = (now - new Date(r.date).getTime()) / 86400000;
    const w = Math.pow(0.5, Math.max(0, ageDays) / 180);
    wSum += w;
    vSum += v * w;
    if (!best || v > best.v) best = { r, v };
  }

  const vdot = vSum / wSum;
  const latestWeight = inbody[inbody.length - 1]?.weightKg ?? best!.r.weightKg ?? 70;
  const baseWeight = best!.r.weightKg ?? latestWeight;
  const rawFactor = baseWeight / latestWeight;
  const factor = Math.min(1.05, Math.max(0.95, rawFactor));

  return {
    vdot,
    baseRace: best!.r,
    weightAdjustedVdot: vdot * factor,
    latestWeight,
    baseWeight,
  };
}

export interface Prediction {
  label: string;
  distanceKm: number;
  timeSec: number;
  paceSecPerKm: number;
}

const TARGETS: { label: string; km: number }[] = [
  { label: "5K", km: 5 },
  { label: "10K", km: 10 },
  { label: "하프", km: 21.0975 },
  { label: "풀코스", km: 42.195 },
];

export function predictAll(races: RaceRecord[], inbody: InbodyEntry[]): Prediction[] {
  const fit = currentFitness(races, inbody);
  return TARGETS.map((t) => {
    const timeSec = predictTimeMin(fit.weightAdjustedVdot, t.km * 1000) * 60;
    return { label: t.label, distanceKm: t.km, timeSec, paceSecPerKm: timeSec / t.km };
  });
}

export interface SplitPrediction {
  fromKm: number;
  toKm: number;
  segmentSec: number;
  cumulativeSec: number;
  paceSecPerKm: number;
  elevGain: number;
  elevLoss: number;
}

export interface UpcomingInput {
  distanceKm: number;
  segments: CourseSegment[];
}

/**
 * 예정 대회 구간 예측:
 * - 균등 페이스에 후반 감속 드리프트(0~+4%)를 선형 적용
 * - 고도 보정: 상승 10m당 +9초, 하강 10m당 -4초
 */
export function predictCourseSplits(
  races: RaceRecord[],
  inbody: InbodyEntry[],
  upcoming: UpcomingInput
): { totalSec: number; splits: SplitPrediction[] } {
  const fit = currentFitness(races, inbody);
  const distM = upcoming.distanceKm * 1000;
  const flatTotalSec = predictTimeMin(fit.weightAdjustedVdot, distM) * 60;
  const basePace = flatTotalSec / upcoming.distanceKm;

  let cumulative = 0;
  const splits: SplitPrediction[] = upcoming.segments.map((s) => {
    const len = s.toKm - s.fromKm;
    const mid = (s.fromKm + s.toKm) / 2;
    const drift = 1 + 0.04 * (mid / upcoming.distanceKm);
    const elevAdj = (s.elevGain / 10) * 9 + (s.elevLoss / 10) * 4;
    const segmentSec = basePace * len * drift + elevAdj;
    cumulative += segmentSec;
    return {
      fromKm: s.fromKm,
      toKm: s.toKm,
      segmentSec,
      cumulativeSec: cumulative,
      paceSecPerKm: segmentSec / len,
      elevGain: s.elevGain,
      elevLoss: s.elevLoss,
    };
  });

  return { totalSec: cumulative, splits };
}
