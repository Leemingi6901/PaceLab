/**
 * 대회일까지 주기화 훈련 계획
 * - 남은 주 수를 기초 → 빌드업 → 피크 → 테이퍼로 분할
 * - 주간 총량은 최근 4주 평균에서 시작해 점진적으로(주당 최대 +8%, 총 최대 1.8배) 늘어나는
 *   "안전한 성장 곡선" 하나로만 결정한다 (이게 유일한 안전 상한선)
 * - 롱런은 대회 거리 기반 목표(대회 거리의 75%, 12~32km)를 향해 기초~피크 구간 동안 독립적으로
 *   늘어나되, 그 주 총량의 45%를 넘지 못하도록 매주 캡을 씌운다 — 그래서 지금 로그된 훈련량이
 *   낮으면(13주 안에 총량이 그만큼 못 크면) 롱런도 이론상 목표(예: 30km)까지 못 가고 총량이
 *   허용하는 선에서 자연스럽게 멈춘다. 총량 자체를 롱런에 맞춰 억지로 부풀리지 않는다.
 * - 4주마다 한 번(3주 증가 + 1주 컷백) 볼륨을 25% 낮춰 회복 주를 넣는다.
 * - 마라톤 페이스는 "지금" 예측치를 그대로 쓴다 — 체력이 오르면 다음에 열 때 자동으로 갱신됨
 */

import type { Prediction } from "./predict";
import { formatPace } from "./predict";
import type { Training } from "./store";

export type TrainingPhase = "기초" | "빌드업" | "피크" | "테이퍼";

export interface PlanWeek {
  weekIndex: number;
  startDate: string;
  phase: TrainingPhase;
  targetKm: number;
  longRunKm: number;
  sessions: string[];
  isRaceWeek: boolean;
  isCutback: boolean;
}

export interface PhasePeriod {
  phase: TrainingPhase;
  startDate: string;
  endDate: string;
  weeks: number;
  totalKm: number;
}

export interface TrainingPlanData {
  totalWeeks: number;
  phaseWeeks: { base: number; build: number; peak: number; taper: number };
  startWeeklyKm: number;
  peakWeeklyKm: number;
  startLongRunKm: number;
  /** 이론상 목표(대회 거리 75%)가 아니라, 이번 계획에서 실제로 도달하는 최대 롱런 거리 */
  peakLongRunKm: number;
  /** 대회 거리 기반 이론상 목표 롱런 (참고용 — 총량이 못 받쳐주면 못 도달할 수 있음) */
  idealPeakLongRunKm: number;
  /** 대회일까지 전체 계획의 누적 목표 거리 */
  totalPlanKm: number;
  /** 단계(기초/빌드업/피크/테이퍼)별 기간과 그 기간의 누적 목표 거리 */
  phasePeriods: PhasePeriod[];
  weeks: PlanWeek[];
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
  predictions: Prediction[]
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

  const fullPace = predictions.find((p) => p.label === "풀코스")?.paceSecPerKm;
  const paceLabel = fullPace ? `${formatPace(fullPace)}/km` : "마라톤 페이스";

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

    const sessions: string[] = [];
    if (isRaceWeek) {
      sessions.push("대회 주 — 훈련량 최소화, 대회 전날 스트라이드 2~3회로 페이스 감각만 확인");
    } else if (phase === "기초") {
      sessions.push(`이지런 2~3회 (합계 약 ${Math.max(0, targetKm - longRunKm).toFixed(1)}km)`);
      sessions.push(`롱런 ${longRunKm}km 전 구간 이지 페이스`);
      sessions.push("주 1회 스트라이드(짧은 가속주) 추천");
    } else if (phase === "빌드업") {
      const tempoKm = Math.min(8, Math.max(3, Math.round(targetKm * 0.15)));
      sessions.push(`이지런 2회 (합계 약 ${Math.max(0, targetKm - longRunKm - tempoKm - 4).toFixed(1)}km)`);
      sessions.push(`템포런 1회: 웜업 2km + 임계치 ${tempoKm}km + 쿨다운 2km`);
      sessions.push(`롱런 ${longRunKm}km — 마지막 20~30%는 마라톤 페이스(${paceLabel})`);
    } else if (phase === "피크") {
      const reps = Math.min(10, Math.max(5, Math.round(targetKm / 6)));
      sessions.push(`이지런 1~2회`);
      sessions.push(`인터벌 1회: 웜업 2km + (1km × ${reps}, 인터벌 페이스 / 400m 조깅) + 쿨다운 2km`);
      sessions.push(`롱런 ${longRunKm}km — 마지막 30~40%는 마라톤 페이스(${paceLabel})`);
    } else {
      sessions.push("훈련량은 줄이되 강도는 유지 — 이지런 위주");
      sessions.push(`마라톤 페이스 2~3km 터치 1회`);
      sessions.push(`롱런 ${longRunKm}km로 축소`);
    }
    if (isCutback) sessions.unshift("컷백(회복) 주 — 볼륨 25%↓로 몸을 회복시키는 주");

    weeks.push({
      weekIndex: i + 1,
      startDate: cursor,
      phase,
      targetKm,
      longRunKm,
      sessions,
      isRaceWeek,
      isCutback,
    });
    cursor = addDaysStr(cursor, 7);
  }

  const phasePeriods: PhasePeriod[] = [];
  for (const w of weeks) {
    const current = phasePeriods[phasePeriods.length - 1];
    if (current && current.phase === w.phase) {
      current.endDate = addDaysStr(w.startDate, 6);
      current.weeks += 1;
      current.totalKm = Math.round((current.totalKm + w.targetKm) * 10) / 10;
    } else {
      phasePeriods.push({
        phase: w.phase,
        startDate: w.startDate,
        endDate: addDaysStr(w.startDate, 6),
        weeks: 1,
        totalKm: w.targetKm,
      });
    }
  }
  const totalPlanKm = Math.round(weeks.reduce((s, w) => s + w.targetKm, 0) * 10) / 10;

  return {
    totalWeeks,
    phaseWeeks: { base, build, peak, taper },
    startWeeklyKm,
    peakWeeklyKm,
    startLongRunKm: Math.round(startLongRunKm * 10) / 10,
    peakLongRunKm: Math.round(achievedPeakLongRunKm * 10) / 10,
    idealPeakLongRunKm,
    totalPlanKm,
    phasePeriods,
    weeks,
  };
}
