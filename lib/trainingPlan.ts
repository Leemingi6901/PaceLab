/**
 * 대회일까지 주기화 훈련 계획
 * - 남은 주 수를 기초 → 빌드업 → 피크 → 테이퍼로 분할해 안전한 성장 곡선(주당 최대 +8%,
 *   총 최대 1.8배)으로 기본 주간 목표를 잡고, 4주마다 컷백(회복) 주를 넣는다
 * - 이 성장 곡선은 최근 로그된 훈련량 기준의 "보수적인 기본값"일 뿐이다. 사용자가 특정
 *   달(예: "2026-08")에 실제로 계획한 목표 마일리지를 입력하면, 그 달에 속한 주들의
 *   기본 목표를 상대적 비율(성장 곡선 모양)은 그대로 유지한 채 스케일링해서 합계가
 *   입력한 목표와 정확히 맞도록 조정한다 — 로그가 적어도 사용자의 실제 계획을 반영하기 위함
 * - 롱런은 대회 거리 기반 이상적 목표(대회 거리의 75%, 12~32km)를 향해 늘리되 그 주
 *   총량의 45%를 넘지 못하게 캡을 씌우고, 월별 목표로 재조정될 때도 같은 비율을 유지한다
 * - 결과는 월(달력 기준)별 누적 마일리지로 집계해 반환한다
 */

import type { Training } from "./store";

type TrainingPhase = "기초" | "빌드업" | "피크" | "테이퍼";

interface PlanWeek {
  startDate: string;
  phase: TrainingPhase;
  targetKm: number;
  longRunKm: number;
  isRaceWeek: boolean;
  isCutback: boolean;
}

export interface MonthlyPeriod {
  /** "YYYY-MM" */
  month: string;
  weeks: number;
  totalKm: number;
  /** 사용자가 이 달에 입력한 목표 마일리지 (있으면) */
  targetKm?: number;
  /** 이 달에 이미 실제로 뛴 거리 (진행 중인 이번 달에만 존재) */
  loggedKm?: number;
}

export interface TrainingPlanData {
  totalWeeks: number;
  totalPlanKm: number;
  monthlyPeriods: MonthlyPeriod[];
}

const GROWTH_PER_WEEK = 1.08;
const MAX_GROWTH_RATIO = 1.8;
const LONG_RUN_MAX_SHARE = 0.45; // 롱런이 그 주 총량에서 차지할 수 있는 최대 비중
const CUTBACK_EVERY = 4; // N주차마다 컷백(회복) 주
const CUTBACK_FACTOR = 0.75;

const TAPER_FRACTIONS: Record<number, number[]> = {
  1: [0.5],
  2: [0.65, 0.4],
  3: [0.75, 0.55, 0.35],
};

/** 로컬 타임존 기준 오늘 날짜 (YYYY-MM-DD) — toISOString()은 UTC라 KST 자정~오전엔 하루 밀릴 수 있어 피한다 */
function todayLocalStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** 이후 날짜 연산은 UTC 자정 기준으로 통일해 로컬 타임존 변환에 의한 하루 밀림을 방지한다 */
function addDaysStr(dateStr: string, days: number): string {
  const d = new Date(dateStr + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function phaseSplit(totalWeeks: number): { base: number; build: number; peak: number; taper: number } {
  const taper = totalWeeks >= 8 ? 3 : totalWeeks >= 5 ? 2 : 1;
  const peak = Math.max(1, Math.round(totalWeeks * 0.15));
  const remaining = Math.max(0, totalWeeks - taper - peak);
  const build = Math.max(1, Math.round(remaining * 0.45));
  const base = Math.max(0, remaining - build);
  return { base, build, peak, taper };
}

export function buildTrainingPlan(
  raceDate: string,
  distanceKm: number,
  trainings: Training[],
  monthlyTargetKm?: Record<string, number>
): TrainingPlanData | null {
  const todayStr = todayLocalStr();
  const daysUntil = Math.ceil(
    (new Date(raceDate + "T00:00:00Z").getTime() - new Date(todayStr + "T00:00:00Z").getTime()) / 86400000
  );
  if (daysUntil <= 0) return null;

  const totalWeeks = Math.max(1, Math.ceil(daysUntil / 7));
  const { base, build, peak, taper } = phaseSplit(totalWeeks);

  const now = Date.now();
  const daysAgo = (d: string) => (now - new Date(d).getTime()) / 86400000;
  const last28 = trainings.filter((t) => daysAgo(t.date) < 28 && daysAgo(t.date) >= 0);
  const startWeeklyKm = Math.max(10, last28.length ? last28.reduce((s, t) => s + t.distanceKm, 0) / 4 : 15);

  const growthRampWeeks = Math.max(1, base + build);
  const peakWeeklyKm = Math.min(startWeeklyKm * MAX_GROWTH_RATIO, startWeeklyKm * Math.pow(GROWTH_PER_WEEK, growthRampWeeks));

  const idealPeakLongRunKm = Math.min(32, Math.max(12, Math.round(distanceKm * 0.75 * 10) / 10));
  const recentLongestKm = last28.length ? Math.max(...last28.map((t) => t.distanceKm)) : 0;
  const startLongRunKm = Math.min(idealPeakLongRunKm * 0.5, Math.max(recentLongestKm, startWeeklyKm * 0.3));
  const longRunRampWeeks = Math.max(1, base + build + peak);

  const weeks: PlanWeek[] = [];
  let cursor = todayStr;
  let achievedPeakLongRunKm = startLongRunKm;

  for (let i = 0; i < totalWeeks; i++) {
    let phase: TrainingPhase;
    let totalGrowthKm: number;
    const inRampPhase = i < base + build + peak;

    if (i < base) {
      phase = "기초";
      totalGrowthKm = startWeeklyKm + (peakWeeklyKm * 0.7 - startWeeklyKm) * ((i + 1) / Math.max(1, base));
    } else if (i < base + build) {
      phase = "빌드업";
      const j = i - base;
      const from = base > 0 ? peakWeeklyKm * 0.7 : startWeeklyKm;
      totalGrowthKm = from + (peakWeeklyKm - from) * ((j + 1) / Math.max(1, build));
    } else if (i < base + build + peak) {
      phase = "피크";
      totalGrowthKm = peakWeeklyKm;
    } else {
      phase = "테이퍼";
      const j = i - (base + build + peak);
      const fractions = TAPER_FRACTIONS[taper] ?? [0.6, 0.4];
      const fraction = fractions[j] ?? fractions[fractions.length - 1];
      totalGrowthKm = peakWeeklyKm * fraction;
    }

    let rawLongRun: number;
    if (inRampPhase) {
      rawLongRun = startLongRunKm + (idealPeakLongRunKm - startLongRunKm) * ((i + 1) / longRunRampWeeks);
    } else {
      const j = i - (base + build + peak);
      const fractions = TAPER_FRACTIONS[taper] ?? [0.6, 0.4];
      const fraction = fractions[j] ?? fractions[fractions.length - 1];
      rawLongRun = achievedPeakLongRunKm * fraction;
    }

    const isRaceWeek = i === totalWeeks - 1;
    const isCutback = inRampPhase && !isRaceWeek && (i + 1) % CUTBACK_EVERY === 0;
    if (isCutback) {
      totalGrowthKm *= CUTBACK_FACTOR;
      rawLongRun *= CUTBACK_FACTOR;
    }

    const targetKm = Math.round(totalGrowthKm * 10) / 10;
    const longRunKm = Math.round(Math.min(rawLongRun, targetKm * LONG_RUN_MAX_SHARE) * 10) / 10;
    if (inRampPhase && !isCutback) achievedPeakLongRunKm = Math.max(achievedPeakLongRunKm, longRunKm);

    weeks.push({ startDate: cursor, phase, targetKm, longRunKm, isRaceWeek, isCutback });
    cursor = addDaysStr(cursor, 7);
  }

  // 사용자가 특정 달에 목표 마일리지를 입력했으면, 그 달에 속한 주들을 성장 곡선 모양은
  // 유지한 채 스케일링해서 합계가 입력값과 정확히 맞도록 조정한다.
  // 계획이 시작되는 이번 달은 오늘까지 이미 실제로 로그된 거리가 있으므로, 그만큼을
  // 목표에서 빼고 "남은 날짜에 뛰어야 할 양"만 주간 목표에 반영한다.
  const currentMonth = todayStr.slice(0, 7);
  const loggedThisMonth =
    Math.round(
      trainings
        .filter((t) => t.date.slice(0, 7) === currentMonth && t.date <= todayStr)
        .reduce((s, t) => s + t.distanceKm, 0) * 10
    ) / 10;

  if (monthlyTargetKm) {
    const byMonth = new Map<string, PlanWeek[]>();
    for (const w of weeks) {
      const month = w.startDate.slice(0, 7);
      const list = byMonth.get(month);
      if (list) list.push(w);
      else byMonth.set(month, [w]);
    }
    for (const [month, monthWeeks] of byMonth) {
      const rawTarget = monthlyTargetKm[month];
      const baseSum = monthWeeks.reduce((s, w) => s + w.targetKm, 0);
      if (!rawTarget || rawTarget <= 0 || baseSum <= 0) continue;
      const target = month === currentMonth ? Math.max(0, rawTarget - loggedThisMonth) : rawTarget;
      const scale = target / baseSum;
      for (const w of monthWeeks) {
        w.targetKm = Math.round(w.targetKm * scale * 10) / 10;
        w.longRunKm = Math.round(Math.min(w.longRunKm * scale, w.targetKm * LONG_RUN_MAX_SHARE) * 10) / 10;
      }
    }
  }

  const monthlyMap = new Map<string, { weeks: number; totalKm: number }>();
  for (const w of weeks) {
    const month = w.startDate.slice(0, 7);
    const cur = monthlyMap.get(month) ?? { weeks: 0, totalKm: 0 };
    cur.weeks += 1;
    cur.totalKm = Math.round((cur.totalKm + w.targetKm) * 10) / 10;
    monthlyMap.set(month, cur);
  }
  // 이번 달은 계획 주차 목표뿐 아니라 이미 실제로 뛴 거리도 합쳐야 그 달의 진짜 누적치가 됨
  if (monthlyMap.has(currentMonth) && loggedThisMonth > 0) {
    const cur = monthlyMap.get(currentMonth)!;
    cur.totalKm = Math.round((cur.totalKm + loggedThisMonth) * 10) / 10;
  }

  const monthlyPeriods: MonthlyPeriod[] = [...monthlyMap.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([month, v]) => ({
      month,
      weeks: v.weeks,
      totalKm: v.totalKm,
      targetKm: monthlyTargetKm?.[month],
      loggedKm: month === currentMonth && loggedThisMonth > 0 ? loggedThisMonth : undefined,
    }));

  const totalPlanKm = Math.round(monthlyPeriods.reduce((s, p) => s + p.totalKm, 0) * 10) / 10;

  return { totalWeeks, totalPlanKm, monthlyPeriods };
}
