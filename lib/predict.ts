/**
 * PB 예측 엔진
 * - Jack Daniels VDOT 공식으로 기록 → 체력 지표(VDOT) 환산
 * - 최근 기록에 가중치를 두고, 인바디 체중 변화로 보정
 * - Riegel/VDOT 기반으로 목표 거리 기록과 구간(스플릿) 예측
 */

import type { Training } from "./store";

export interface RaceRecord {
  race: string;
  date: string;
  distanceKm: number;
  time: string;
  weightKg?: number;
  maxHr?: number;
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
export function currentFitness(races: RaceRecord[], inbody: InbodyEntry[]): FitnessSummary | null {
  if (races.length === 0) return null;
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
  if (!fit) return [];
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
): { totalSec: number; splits: SplitPrediction[] } | null {
  const fit = currentFitness(races, inbody);
  if (!fit) return null;
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

/**
 * 고도 보정 페이스 (Grade-Adjusted Pace):
 * 업힐/다운힐을 반영해 "평지였다면 어느 정도 페이스였을지"로 환산한다.
 * 코스 구간 예측과 동일한 계수(상승 10m당 +9초, 하강 10m당 -4초)를 역으로 적용 —
 * 오르막에서 느려진 시간은 빼고(더 빠른 평지 페이스로 환산), 내리막에서 번 시간은 더한다.
 */
export function gradeAdjustedPace(timeSec: number, distanceKm: number, elevGainM: number, elevLossM: number): number {
  const elevAdjSec = (elevGainM / 10) * 9 - (elevLossM / 10) * 4;
  const flatSec = Math.max(0, timeSec - elevAdjSec);
  return flatSec / distanceKm;
}

export type IntensityZone = "이지" | "마라톤" | "템포" | "인터벌" | "레페티션" | "—";

/** 고도 보정 페이스를 현재 체력의 거리별 예상 페이스와 비교해 강도 구간을 분류한다 (Daniels 훈련 존 기준) */
export function classifyIntensity(gapSecPerKm: number, predictions: Prediction[]): IntensityZone {
  if (predictions.length === 0) return "—";
  const byLabel = Object.fromEntries(predictions.map((p) => [p.label, p.paceSecPerKm]));
  const full = byLabel["풀코스"];
  const half = byLabel["하프"];
  const tenK = byLabel["10K"];
  const fiveK = byLabel["5K"];
  if (!full || !half || !tenK || !fiveK) return "—";
  if (gapSecPerKm >= full * 1.08) return "이지";
  if (gapSecPerKm >= (full + half) / 2) return "마라톤";
  if (gapSecPerKm >= (half + tenK) / 2) return "템포";
  if (gapSecPerKm >= (tenK + fiveK) / 2) return "인터벌";
  return "레페티션";
}

export interface WorkoutRecommendation {
  level: "하" | "중" | "상";
  title: string;
  distanceKm: number;
  paceSecPerKm: number;
  structure: string;
  reason: string;
  recommended: boolean;
}

/**
 * 다음 훈련 추천:
 * - 최근 4주 훈련량(주간 평균)과 이번 주 훈련량을 비교해 과부하 여부 판단
 * - 최근 "템포/인터벌/레페티션" 강도 훈련 이후 경과일로 다음 자극 시점 판단
 * - 위 신호로 하/중/상 중 하나를 "추천"으로 표시하고, 나머지도 항상 함께 제시
 */
export function recommendWorkouts(trainings: Training[], predictions: Prediction[]): WorkoutRecommendation[] | null {
  if (predictions.length === 0 || trainings.length === 0) return null;

  const byLabel = Object.fromEntries(predictions.map((p) => [p.label, p.paceSecPerKm]));
  const fullPace = byLabel["풀코스"];
  const halfPace = byLabel["하프"];
  const tenKPace = byLabel["10K"];
  const fiveKPace = byLabel["5K"];
  if (!fullPace || !halfPace || !tenKPace || !fiveKPace) return null;

  const now = Date.now();
  const sorted = [...trainings].sort((a, b) => a.date.localeCompare(b.date));
  const last = sorted[sorted.length - 1];
  const daysAgo = (dateStr: string) => Math.floor((now - new Date(dateStr).getTime()) / 86400000);

  const last28 = sorted.filter((t) => daysAgo(t.date) < 28);
  const last7 = sorted.filter((t) => daysAgo(t.date) < 7);
  const avgWeeklyKm = last28.length ? last28.reduce((s, t) => s + t.distanceKm, 0) / 4 : 0;
  const thisWeekKm = last7.reduce((s, t) => s + t.distanceKm, 0);
  const pool = last28.length ? last28 : sorted;
  const avgDistance = pool.reduce((s, t) => s + t.distanceKm, 0) / pool.length;

  let daysSinceHard = 999;
  for (const t of sorted) {
    const gap = gradeAdjustedPace(parseTime(t.time), t.distanceKm, t.elevGainM ?? 0, t.elevLossM ?? 0);
    const zone = classifyIntensity(gap, predictions);
    if (zone === "템포" || zone === "인터벌" || zone === "레페티션") {
      const d = daysAgo(t.date);
      if (d < daysSinceHard) daysSinceHard = d;
    }
  }
  const daysSinceLast = last ? daysAgo(last.date) : 999;
  const overloaded = avgWeeklyKm > 0 && thisWeekKm > avgWeeklyKm * 1.3;

  let recommendedLevel: "하" | "중" | "상";
  let topReason: string;
  if (daysSinceLast <= 0 || overloaded) {
    recommendedLevel = "하";
    topReason = overloaded
      ? "이번 주 주행거리가 평소보다 많아요 — 회복 위주로 가볍게 다녀오세요."
      : "오늘 이미 훈련하셨네요 — 다음엔 가볍게 회복 조깅을 권장해요.";
  } else if (daysSinceHard >= 6) {
    recommendedLevel = "상";
    topReason = `강도 높은 훈련을 ${daysSinceHard}일째 쉬셨어요 — 인터벌로 자극을 줄 타이밍입니다.`;
  } else if (daysSinceHard >= 3) {
    recommendedLevel = "중";
    topReason = "회복과 자극의 균형이 좋은 시점이에요 — 템포런이 적당합니다.";
  } else {
    recommendedLevel = "하";
    topReason = "최근 강도 높은 훈련을 하셨으니 이번엔 가볍게 회복하세요.";
  }

  const easyDistance = Math.max(3, Math.round(avgDistance * 0.8 * 10) / 10);
  const easyPace = fullPace * 1.12;

  const tempoKm = Math.min(8, Math.max(3, Math.round(avgDistance * 0.6 * 10) / 10));
  const tempoPace = halfPace;
  const tempoTotal = Math.round((tempoKm + 4) * 10) / 10;

  const intervalReps = Math.min(10, Math.max(4, Math.round(avgWeeklyKm / 8) || 4));
  const intervalPace = (tenKPace + fiveKPace) / 2;
  const intervalTotal = Math.round((2 + intervalReps * 1 + (intervalReps - 1) * 0.4 + 2) * 10) / 10;

  return [
    {
      level: "하",
      title: "회복 조깅",
      distanceKm: easyDistance,
      paceSecPerKm: easyPace,
      structure: `${easyDistance}km 전 구간 이지 페이스 — 대화 가능한 강도로`,
      reason: recommendedLevel === "하" ? topReason : "가볍게 몸을 풀고 다음 훈련을 준비하고 싶을 때",
      recommended: recommendedLevel === "하",
    },
    {
      level: "중",
      title: "템포런",
      distanceKm: tempoTotal,
      paceSecPerKm: tempoPace,
      structure: `웜업 2km + 템포 ${tempoKm}km(하프 페이스) + 쿨다운 2km`,
      reason: recommendedLevel === "중" ? topReason : "젖산역치를 끌어올리고 싶을 때",
      recommended: recommendedLevel === "중",
    },
    {
      level: "상",
      title: "인터벌",
      distanceKm: intervalTotal,
      paceSecPerKm: intervalPace,
      structure: `웜업 2km + (1km × ${intervalReps}회, 인터벌 페이스 / 400m 조깅 리커버리) + 쿨다운 2km`,
      reason: recommendedLevel === "상" ? topReason : "스피드와 VO2max를 자극하고 싶을 때",
      recommended: recommendedLevel === "상",
    },
  ];
}
