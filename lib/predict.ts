/**
 * PB 예측 엔진
 * - VDOT 공식으로 기록 → 체력 지표(VDOT) 환산
 * - 최근 기록에 가중치를 두고, 인바디 체중 변화로 보정
 * - VDOT 기반으로 목표 거리 기록과 구간(스플릿) 예측
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

/** 워치·기기로 측정한 VO2max 기록 — 인바디와 측정 주기가 달라 별도로 관리한다 */
export interface Vo2maxEntry {
  date: string;
  vo2max: number;
}

export interface CourseSegment {
  fromKm: number;
  toKm: number;
  elevGain: number;
  elevLoss: number;
}

export interface ElevationPoint {
  km: number;
  elevM: number;
}

function elevAt(profile: ElevationPoint[], km: number): number {
  if (km <= profile[0].km) return profile[0].elevM;
  const last = profile[profile.length - 1];
  if (km >= last.km) return last.elevM;
  for (let i = 0; i < profile.length - 1; i++) {
    const a = profile[i];
    const b = profile[i + 1];
    if (km >= a.km && km <= b.km) {
      const t = (km - a.km) / (b.km - a.km || 1);
      return a.elevM + (b.elevM - a.elevM) * t;
    }
  }
  return last.elevM;
}

/** 세밀한 고도 프로파일(km, 고도)을 bucketKm 단위 구간의 상승/하강 합계로 변환한다 */
export function segmentsFromProfile(distanceKm: number, profile: ElevationPoint[], bucketKm = 5): CourseSegment[] {
  const sorted = [...profile].sort((a, b) => a.km - b.km);
  if (sorted.length < 2) return [];

  const segments: CourseSegment[] = [];
  for (let from = 0; from < distanceKm; from += bucketKm) {
    const to = Math.min(from + bucketKm, distanceKm);
    const inBucket = sorted.filter((p) => p.km > from && p.km < to);
    const boundary: ElevationPoint[] = [
      { km: from, elevM: elevAt(sorted, from) },
      ...inBucket,
      { km: to, elevM: elevAt(sorted, to) },
    ];
    let gain = 0;
    let loss = 0;
    for (let i = 0; i < boundary.length - 1; i++) {
      const delta = boundary[i + 1].elevM - boundary[i].elevM;
      if (delta > 0) gain += delta;
      else loss += -delta;
    }
    segments.push({ fromKm: from, toKm: Math.round(to * 1000) / 1000, elevGain: Math.round(gain), elevLoss: Math.round(loss) });
  }
  return segments;
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

/** 거리(m)·시간(분) → VDOT */
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
  /** 대회 기록 간 VDOT 편차(가중 변동계수) — 기록이 들쭉날쭉할수록 커짐 */
  vdotSpreadPct: number;
  /** 예상 기록 범위 폭(±). 아래 UNCERTAINTY_FLOOR~CAP 사이로 캡 */
  uncertaintyPct: number;
}

export const UNCERTAINTY_FLOOR = 0.03; // 최소 ±3% — 대회 당일 컨디션·날씨 등 기본 변동성
export const UNCERTAINTY_CAP = 0.12; // 최대 ±12%

/**
 * 현재 체력 추정:
 * - 각 대회 기록의 VDOT 계산 후, 최근 기록일수록 큰 가중치(6개월 반감기)
 * - 체중 보정: 상대 VO2max는 체중에 반비례 → vdot × (기록 당시 체중 / 현재 체중), ±5% 캡
 * - 대회 기록 간 VDOT 편차(가중 변동계수)로 예상 기록의 불확실성 범위도 함께 계산
 */
export function currentFitness(races: RaceRecord[], inbody: InbodyEntry[]): FitnessSummary | null {
  if (races.length === 0) return null;
  const now = Date.now();
  let wSum = 0;
  let vSum = 0;
  let vSqSum = 0;
  let best: { r: RaceRecord; v: number } | null = null;

  for (const r of races) {
    const v = vdotFromRace(r.distanceKm * 1000, parseTime(r.time) / 60);
    const ageDays = (now - new Date(r.date).getTime()) / 86400000;
    const w = Math.pow(0.5, Math.max(0, ageDays) / 180);
    wSum += w;
    vSum += v * w;
    vSqSum += v * v * w;
    if (!best || v > best.v) best = { r, v };
  }

  const vdot = vSum / wSum;
  const variance = Math.max(0, vSqSum / wSum - vdot * vdot);
  const vdotSpreadPct = vdot > 0 ? Math.sqrt(variance) / vdot : 0;
  const uncertaintyPct = Math.min(UNCERTAINTY_CAP, Math.max(UNCERTAINTY_FLOOR, UNCERTAINTY_FLOOR + vdotSpreadPct * 0.5));

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
    vdotSpreadPct,
    uncertaintyPct,
  };
}

export interface Prediction {
  label: string;
  distanceKm: number;
  /** 확률상 가장 가능성 높은(중심) 예상 기록 */
  timeSec: number;
  paceSecPerKm: number;
  /** 컨디션 좋을 때(베스트 케이스) */
  lowSec: number;
  /** 컨디션 난조일 때(워스트 케이스) */
  highSec: number;
}

const TARGETS: { label: string; km: number }[] = [
  { label: "5K", km: 5 },
  { label: "10K", km: 10 },
  { label: "하프", km: 21.0975 },
  { label: "풀코스", km: 42.195 },
];

export function predictAll(fit: FitnessSummary | null): Prediction[] {
  if (!fit) return [];
  const u = fit.uncertaintyPct;
  return TARGETS.map((t) => {
    const timeSec = predictTimeMin(fit.weightAdjustedVdot, t.km * 1000) * 60;
    return {
      label: t.label,
      distanceKm: t.km,
      timeSec,
      paceSecPerKm: timeSec / t.km,
      lowSec: timeSec * (1 - u),
      highSec: timeSec * (1 + u),
    };
  });
}

export interface BestEffort {
  time: string;
  timeSec: number;
  distanceKm: number;
  paceSecPerKm: number;
  source: string;
  date: string;
  isRace: boolean;
}

/**
 * 목표 거리(km) "이상"을 실제로 뛴 기록 중 완주 시간이 가장 짧은 것을 PB로 반환한다. 없으면 null.
 * 공식 대회 기록뿐 아니라 훈련 기록도 함께 본다.
 *
 * 짧게 뛴 기록의 페이스를 목표 거리까지 늘려서 "PB"로 치지 않는다 — 실제로 그 거리를 다 뛴 게
 * 아니라면 그 페이스를 끝까지 유지했을지 알 수 없기 때문이다. 그래서 최소 거리는 target×0.97
 * (GPS 오차 정도만 허용)로 엄격하게 잡는다. 순위는 페이스가 아니라 실제 완주 시간으로 매긴다 —
 * 예를 들어 10.0km를 6'55"/km로 뛴 기록과 11.3km를 6'43"/km로 뛴 기록이 있으면, 페이스는
 * 후자가 더 빠르지만 "10K를 가장 빨리 뛴 시간"은 실제로 더 짧게 걸린 전자다. 더 길게 뛴 기록은
 * 그만큼 시간도 오래 걸리므로 완주 시간 비교에서 자연히 불리해져 target×1.5까지만 폭넓게 허용해도
 * 문제되지 않는다. 트레드밀 기록은 보정 시간을 쓴다.
 *
 * 훈련 기록은 평균심박이 있으면 "이지" 강도로 판단되는 것은 PB 후보에서 제외한다 — 페이스는
 * 전력질주 수준인데 심박은 여유심박 72% 미만(가벼운 강도)인 경우, 진짜 그렇게 빨리 뛴 게 아니라
 * 트레드밀 거리 센서 오류 등으로 거리/시간이 잘못 기록됐을 가능성이 높다고 보기 때문이다.
 */
export function personalBest(
  races: RaceRecord[],
  trainings: Training[],
  targetKm: number,
  maxHr?: number,
  restHr?: number,
  undershootTolerance = 0.03,
  overshootTolerance = 0.5
): BestEffort | null {
  const minKm = targetKm * (1 - undershootTolerance);
  const maxKm = targetKm * (1 + overshootTolerance);
  const inRange = (km: number) => km >= minKm && km <= maxKm;

  const candidates: BestEffort[] = [];
  for (const r of races) {
    if (!inRange(r.distanceKm)) continue;
    const timeSec = parseTime(r.time);
    candidates.push({
      time: r.time,
      timeSec,
      distanceKm: r.distanceKm,
      paceSecPerKm: timeSec / r.distanceKm,
      source: r.race,
      date: r.date,
      isRace: true,
    });
  }
  for (const t of trainings) {
    if (!inRange(t.distanceKm)) continue;
    if (t.avgHr && maxHr && classifyIntensityFromHr(t.avgHr, maxHr, restHr) === "이지") continue;
    const timeSec = effectiveTimeSec(parseTime(t.time), t.treadmill);
    candidates.push({
      time: formatTime(timeSec),
      timeSec,
      distanceKm: t.distanceKm,
      paceSecPerKm: timeSec / t.distanceKm,
      source: t.note || "훈련 기록",
      date: t.date,
      isRace: false,
    });
  }
  if (candidates.length === 0) return null;
  return candidates.reduce((best, c) => (c.timeSec < best.timeSec ? c : best));
}

export interface WeightScenario {
  deltaKg: number;
  weightKg: number;
  marathonSec: number;
  /** 지금(deltaKg=0) 대비 마라톤 예상 기록 차이(초). 음수면 더 빨라짐 */
  marathonDeltaSec: number;
}

/**
 * 체중이 지금보다 ±deltaKg 달라지면 마라톤(42.195km) 예상 기록이 어떻게 바뀌는지 보여준다.
 * 체지방·근육량의 "적정 비율"을 처방하는 게 아니라, 이 앱이 이미 예측에 쓰고 있는 "대회 당시
 * 체중 대비 최근 체중" 공식(±5% 캡)을 그대로 가정법으로 계산해 보여줄 뿐이다 — 의학적·영양학적
 * 조언이 아니다. combinedFactor(훈련량·체성분 추이·VO2max 보정)는 그대로 곱해 다른 조건은
 * 고정한다.
 */
export function weightScenarios(
  races: RaceRecord[],
  inbody: InbodyEntry[],
  combinedFactor: number,
  deltasKg: number[] = [-3, -2, -1, 0, 1, 2]
): WeightScenario[] {
  if (races.length === 0 || inbody.length === 0) return [];
  const latest = inbody[inbody.length - 1];

  const results = deltasKg.map((deltaKg) => {
    const weightKg = Math.round((latest.weightKg + deltaKg) * 10) / 10;
    const hypoInbody = [...inbody.slice(0, -1), { ...latest, weightKg }];
    const base = currentFitness(races, hypoInbody);
    const vdot = base ? base.weightAdjustedVdot * combinedFactor : 0;
    const marathonSec = base ? predictTimeMin(vdot, 42195) * 60 : 0;
    return { deltaKg, weightKg, marathonSec };
  });

  const zero = results.find((r) => r.deltaKg === 0) ?? results[0];
  return results.map((r) => ({ ...r, marathonDeltaSec: r.marathonSec - zero.marathonSec }));
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
  fit: FitnessSummary | null,
  upcoming: UpcomingInput
): { totalSec: number; lowSec: number; highSec: number; splits: SplitPrediction[] } | null {
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

  const u = fit.uncertaintyPct;
  return { totalSec: cumulative, lowSec: cumulative * (1 - u), highSec: cumulative * (1 + u), splits };
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

/**
 * 트레드밀 보정 계수:
 * 트레드밀은 벨트가 다리를 끌어주고 공기저항이 없어 같은 페이스라도 실외보다 쉽다.
 * 실측 결과(30분/6'00"페이스 실내 ≈ 33분/6'36"페이스 실외 강도)를 반영해 +10% 적용 —
 * 같은 거리를 뛴 것으로 치되, 체감 강도를 비교할 땐 시간을 10% 늘려 실외 환산한다.
 */
export const TREADMILL_CORRECTION = 1.1;

/** 트레드밀이면 기록 시간에 보정 계수를 적용해 "실외 환산 시간(초)"을 반환 */
export function effectiveTimeSec(rawTimeSec: number, treadmill?: boolean): number {
  return treadmill ? rawTimeSec * TREADMILL_CORRECTION : rawTimeSec;
}

export type IntensityZone = "이지" | "보통" | "하드" | "—";

interface ZoneBreakpoints {
  /** 이보다 느리면 이지 (풀코스 페이스 × 1.08) */
  easy: number;
  /** 이보다 빠르면 하드, 이 값과 easy 사이면 보통 (풀코스·하프 중간 페이스) */
  hard: number;
}

/** 예측 페이스(하프/풀코스)로부터 강도 구간 경계(sec/km)를 구한다. 예측이 없으면 null */
function zoneBreakpoints(predictions: Prediction[]): ZoneBreakpoints | null {
  if (predictions.length === 0) return null;
  const byLabel = Object.fromEntries(predictions.map((p) => [p.label, p.paceSecPerKm]));
  const full = byLabel["풀코스"];
  const half = byLabel["하프"];
  if (!full || !half) return null;
  return { easy: full * 1.08, hard: (full + half) / 2 };
}

/** 고도 보정 페이스를 현재 체력의 예상 페이스와 비교해 강도(이지/보통/하드)를 분류한다 */
export function classifyIntensity(gapSecPerKm: number, predictions: Prediction[]): IntensityZone {
  const bp = zoneBreakpoints(predictions);
  if (!bp) return "—";
  if (gapSecPerKm >= bp.easy) return "이지";
  if (gapSecPerKm >= bp.hard) return "보통";
  return "하드";
}

const HR_EASY_MAX = 0.72; // 이보다 낮은 %여유심박이면 이지
const HR_HARD_MIN = 0.86; // 이보다 높은 %여유심박이면 하드

/** 평균 심박(여유심박 %)으로 강도(이지/보통/하드)를 분류한다. 페이스보다 그날의 실제 체감 강도를 더 직접적으로 반영한다 */
export function classifyIntensityFromHr(avgHr: number, maxHr: number, restHr?: number): IntensityZone {
  const pct = restHr && restHr > 0 && restHr < maxHr ? (avgHr - restHr) / (maxHr - restHr) : avgHr / maxHr;
  if (pct < HR_EASY_MAX) return "이지";
  if (pct < HR_HARD_MIN) return "보통";
  return "하드";
}

/**
 * 강도를 결정한다: 직접 태그 > 심박(있으면, 그날 체감 강도를 더 직접 반영) > 페이스 자동 분류 순.
 */
export function resolveIntensity(
  gapSecPerKm: number,
  predictions: Prediction[],
  override?: IntensityZone,
  avgHr?: number,
  maxHr?: number,
  restHr?: number
): IntensityZone {
  if (override) return override;
  if (avgHr && maxHr) return classifyIntensityFromHr(avgHr, maxHr, restHr);
  return classifyIntensity(gapSecPerKm, predictions);
}

/**
 * 강도 존의 페이스 밴드(sec/km)를 반환한다. lo=빠른 쪽 경계, hi=느린 쪽 경계.
 * 이지/하드처럼 한쪽으로 열린 구간은 보통 구간과 같은 폭을 그 방향으로 가정해 밴드를 만든다.
 * 예측이 없으면 null.
 */
export function zonePaceBand(zone: IntensityZone, predictions: Prediction[]): { lo: number; hi: number } | null {
  const bp = zoneBreakpoints(predictions);
  if (!bp || zone === "—") return null;
  const width = bp.easy - bp.hard;
  if (zone === "이지") return { lo: bp.easy, hi: bp.easy + width };
  if (zone === "보통") return { lo: bp.hard, hi: bp.easy };
  return { hi: bp.hard, lo: bp.hard - width };
}

/** "5'58"~6'12"/km" 처럼 강도 존의 목표 페이스 범위를 사람이 읽는 문자열로 반환한다 */
export function zoneBandLabel(zone: IntensityZone, predictions: Prediction[]): string | null {
  const band = zonePaceBand(zone, predictions);
  if (!band) return null;
  return `${formatPace(band.lo)}~${formatPace(band.hi)}/km`;
}

/**
 * GAP이 분류된 존의 "한가운데"에 얼마나 가까운지 0~1로 반환한다 (1=정중앙).
 * 경계를 살짝 벗어난 정도로 0점까지 뚝 떨어지지 않도록, 구간 밖으로도 완만하게 감쇠시킨다
 * (반폭의 2.5배 떨어진 지점에서 0에 도달).
 */
export function gapCenteringFraction(gapSecPerKm: number, zone: IntensityZone, predictions: Prediction[]): number {
  const band = zonePaceBand(zone, predictions);
  if (!band) return 0.5;
  const { lo, hi } = band;
  const center = (lo + hi) / 2;
  const halfWidth = (hi - lo) / 2 || 1;
  const reach = halfWidth * 2.5;
  return Math.max(0, Math.min(1, 1 - Math.abs(gapSecPerKm - center) / reach));
}

export type RunnerTierName = "챌린저" | "다이아몬드" | "플래티넘" | "골드" | "실버" | "브론즈" | "언랭크";

export interface RunnerTier {
  tier: RunnerTierName;
  percentileLabel: string;
}

/**
 * 전 세계 러너 티어:
 * 마라톤 완주 기록 기준의 근사 퍼센타일 벤치마크를 VDOT로 환산해 구간을 나눈다.
 * (공식 글로벌 통계가 아닌, 마라톤 완주자 분포에 대한 일반적으로 알려진 근사치 기준)
 */
const TIER_BENCHMARKS: { tier: RunnerTierName; percentileLabel: string; marathonTime: string }[] = [
  { tier: "챌린저", percentileLabel: "상위 0.1%", marathonTime: "2:20:00" },
  { tier: "다이아몬드", percentileLabel: "상위 1%", marathonTime: "2:45:00" },
  { tier: "플래티넘", percentileLabel: "상위 10%", marathonTime: "3:15:00" },
  { tier: "골드", percentileLabel: "상위 30%", marathonTime: "3:45:00" },
  { tier: "실버", percentileLabel: "상위 60%", marathonTime: "4:15:00" },
  { tier: "브론즈", percentileLabel: "상위 80%", marathonTime: "5:00:00" },
];

export function getRunnerTier(vdot: number): RunnerTier {
  for (const b of TIER_BENCHMARKS) {
    const benchVdot = vdotFromRace(42195, parseTime(b.marathonTime) / 60);
    if (vdot >= benchVdot) return { tier: b.tier, percentileLabel: b.percentileLabel };
  }
  return { tier: "언랭크", percentileLabel: "상위 80% 밖" };
}

export interface WorkoutRecommendation {
  level: "하" | "중" | "상";
  title: string;
  distanceKm: number;
  paceSecPerKm: number;
  structure: string;
  reason: string;
  recommended: boolean;
  /** "Z1~Z2" 등 심박존 라벨 (최대심박 기록이 없으면 undefined) */
  hrZone?: string;
  /** "145bpm 이하 유지" 처럼 바로 표시 가능한 문구 */
  hrGuidance?: string;
  /** 구간마다 페이스가 달라지는 훈련(템포/인터벌 등)의 구간별 목표 페이스. 전 구간 페이스가 같으면 undefined */
  segments?: { range: string; paceSecPerKm: number; note: string }[];
}

/**
 * 심박존 구간표 (Daniels E/M/T/I 강도에 흔히 대응되는 심박존 관례를 따름).
 * 회복 조깅은 Z1~Z2, 템포런은 Z4, 인터벌은 Z5를 목표로 삼는다.
 * 안정시 심박이 있으면 Karvonen(여유심박, HRR) 방식으로, 없으면 단순 %HRmax로 계산한다 —
 * HRR 방식이 개인차(안정시 심박 차이)를 반영해 더 정확하다고 알려져 있다.
 */
const HR_ZONES = {
  recovery: { label: "Z1~Z2", min: 0.55, max: 0.7 },
  marathon: { label: "Z3", min: 0.75, max: 0.84 },
  tempo: { label: "Z4", min: 0.87, max: 0.92 },
  interval: { label: "Z5", min: 0.93, max: 1.0 },
  repetition: { label: "Z5+", min: 0.95, max: 1.03 },
} as const;

function hrTarget(pct: number, maxHr: number, restHr?: number): number {
  if (restHr && restHr > 0 && restHr < maxHr) return restHr + pct * (maxHr - restHr);
  return pct * maxHr;
}

function hrGuidanceFor(
  zone: keyof typeof HR_ZONES,
  maxHr?: number,
  restHr?: number
): { hrZone?: string; hrGuidance?: string } {
  if (!maxHr || maxHr <= 0) return {};
  const { label, min, max } = HR_ZONES[zone];
  const lo = Math.round(hrTarget(min, maxHr, restHr));
  const hi = Math.round(hrTarget(max, maxHr, restHr));
  if (zone === "interval") return { hrZone: label, hrGuidance: `${lo}bpm 이상 유지` };
  return { hrZone: label, hrGuidance: `${lo}~${hi}bpm 유지` };
}

/**
 * 다음 훈련 추천:
 * - 최근 4주 훈련량(주간 평균)과 이번 주 훈련량을 비교해 과부하 여부 판단
 * - 최근 "템포/인터벌/레페티션" 강도 훈련 이후 경과일로 다음 자극 시점 판단
 * - 위 신호로 하/중/상 중 하나를 "추천"으로 표시하고, 나머지도 항상 함께 제시
 * - 최대심박(+안정시심박)이 있으면 페이스와 함께 심박 목표도 제시
 */
export function recommendWorkouts(
  trainings: Training[],
  predictions: Prediction[],
  tsb?: number,
  maxHr?: number,
  restHr?: number
): WorkoutRecommendation[] | null {
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
    const timeSec = effectiveTimeSec(parseTime(t.time), t.treadmill);
    const gap = gradeAdjustedPace(timeSec, t.distanceKm, t.elevGainM ?? 0, t.elevLossM ?? 0);
    const zone = resolveIntensity(gap, predictions, t.intensityOverride, t.avgHr, maxHr, restHr);
    if (zone === "하드") {
      const d = daysAgo(t.date);
      if (d < daysSinceHard) daysSinceHard = d;
    }
  }
  const daysSinceLast = last ? daysAgo(last.date) : 999;
  const overloaded = avgWeeklyKm > 0 && thisWeekKm > avgWeeklyKm * 1.3;

  // 훈련 부하 모델(CTL/ATL/TSB)이 있으면 피로 신호를 최우선으로, 여유가 있으면 상향 조정에 참고한다
  const veryFatigued = tsb !== undefined && tsb <= -20;
  const wellRested = tsb !== undefined && tsb >= 10;

  let recommendedLevel: "하" | "중" | "상";
  let topReason: string;
  if (daysSinceLast <= 0 || overloaded) {
    recommendedLevel = "하";
    topReason = overloaded
      ? "이번 주 주행거리가 평소보다 많아요 — 회복 위주로 가볍게 다녀오세요."
      : "오늘 이미 훈련하셨네요 — 다음엔 가볍게 회복 조깅을 권장해요.";
  } else if (veryFatigued) {
    recommendedLevel = "하";
    topReason = `최근 훈련부하가 많이 쌓여 피로도가 높아요(TSB ${tsb!.toFixed(0)}) — 강도 높은 훈련보다 회복이 우선입니다.`;
  } else if (daysSinceHard >= 6) {
    recommendedLevel = "상";
    topReason = wellRested
      ? `컨디션이 좋고(TSB ${tsb!.toFixed(0)}) 강도 높은 훈련을 ${daysSinceHard}일째 쉬셨어요 — 인터벌로 자극을 줄 타이밍입니다.`
      : `강도 높은 훈련을 ${daysSinceHard}일째 쉬셨어요 — 인터벌로 자극을 줄 타이밍입니다.`;
  } else if (daysSinceHard >= 3) {
    recommendedLevel = wellRested ? "상" : "중";
    topReason = wellRested
      ? `컨디션이 좋아요(TSB ${tsb!.toFixed(0)}) — 평소보다 이른 타이밍이지만 인터벌 자극을 줘도 좋습니다.`
      : "회복과 자극의 균형이 좋은 시점이에요 — 템포런이 적당합니다.";
  } else {
    recommendedLevel = "하";
    topReason = "최근 강도 높은 훈련을 하셨으니 이번엔 가볍게 회복하세요.";
  }

  const easyDistance = Math.max(3, Math.round(avgDistance * 0.8 * 10) / 10);
  const easyPace = fullPace * 1.12;

  const tempoKm = Math.min(8, Math.max(3, Math.round(avgDistance * 0.6 * 10) / 10));
  const tempoPace = halfPace;
  const tempoWarmupKm = 2;
  const tempoMainEnd = Math.round((tempoWarmupKm + tempoKm) * 10) / 10;
  const tempoTotal = Math.round((tempoMainEnd + 2) * 10) / 10;

  const intervalReps = Math.min(10, Math.max(4, Math.round(avgWeeklyKm / 8) || 4));
  const intervalPace = (tenKPace + fiveKPace) / 2;
  const intervalWarmupKm = 2;
  const intervalBlockKm = intervalReps * 1 + (intervalReps - 1) * 0.4;
  const intervalMainEnd = Math.round((intervalWarmupKm + intervalBlockKm) * 10) / 10;
  const intervalTotal = Math.round((intervalMainEnd + 2) * 10) / 10;

  return [
    {
      level: "하",
      title: "회복 조깅",
      distanceKm: easyDistance,
      paceSecPerKm: easyPace,
      structure: `${easyDistance}km 전 구간 이지 페이스 — 대화 가능한 강도로`,
      reason: recommendedLevel === "하" ? topReason : "가볍게 몸을 풀고 다음 훈련을 준비하고 싶을 때",
      recommended: recommendedLevel === "하",
      ...hrGuidanceFor("recovery", maxHr, restHr),
    },
    {
      level: "중",
      title: "템포런",
      distanceKm: tempoTotal,
      paceSecPerKm: tempoPace,
      structure: `웜업 2km + 템포 ${tempoKm}km(하프 페이스) + 쿨다운 2km`,
      reason: recommendedLevel === "중" ? topReason : "젖산역치를 끌어올리고 싶을 때",
      recommended: recommendedLevel === "중",
      ...hrGuidanceFor("tempo", maxHr, restHr),
      segments: [
        { range: `0~${tempoWarmupKm}km`, paceSecPerKm: easyPace, note: "웜업" },
        { range: `${tempoWarmupKm}~${tempoMainEnd}km`, paceSecPerKm: tempoPace, note: "템포 (하프 페이스)" },
        { range: `${tempoMainEnd}~${tempoTotal}km`, paceSecPerKm: easyPace, note: "쿨다운" },
      ],
    },
    {
      level: "상",
      title: "인터벌",
      distanceKm: intervalTotal,
      paceSecPerKm: intervalPace,
      structure: `웜업 2km + (1km × ${intervalReps}회, 인터벌 페이스 / 400m 조깅 리커버리) + 쿨다운 2km`,
      reason: recommendedLevel === "상" ? topReason : "스피드와 VO2max를 자극하고 싶을 때",
      recommended: recommendedLevel === "상",
      ...hrGuidanceFor("interval", maxHr, restHr),
      segments: [
        { range: `0~${intervalWarmupKm}km`, paceSecPerKm: easyPace, note: "웜업" },
        {
          range: `${intervalWarmupKm}~${intervalMainEnd}km`,
          paceSecPerKm: intervalPace,
          note: `1km × ${intervalReps}회 인터벌 페이스 (반복 사이 400m 조깅 리커버리)`,
        },
        { range: `${intervalMainEnd}~${intervalTotal}km`, paceSecPerKm: easyPace, note: "쿨다운" },
      ],
    },
  ];
}
