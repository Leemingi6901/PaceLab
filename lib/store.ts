import { put, list, del } from "@vercel/blob";
import type { RaceRecord, InbodyEntry, Vo2maxEntry, CourseSegment, ElevationPoint, IntensityZone } from "./predict";

export interface Training {
  id: string;
  date: string;
  distanceKm: number;
  time: string; // "MM:SS" | "H:MM:SS"
  avgHr?: number;
  elevGainM?: number;
  elevLossM?: number;
  treadmill?: boolean;
  note?: string;
  /** 사용자가 직접 지정한 강도 — 있으면 페이스 기준 자동 분류 대신 이 값을 쓴다 */
  intensityOverride?: IntensityZone;
  /** 가민 Connect activityId — 자동 동기화가 같은 활동을 중복 저장하지 않도록 구분하는 키 */
  garminId?: string;
}

export interface UpcomingRace {
  name: string;
  date: string;
  distanceKm: number;
  location: string;
  courseNote: string;
  segments: CourseSegment[];
  elevationProfile?: ElevationPoint[];
  /** 사용자가 직접 입력한 달(YYYY-MM)별 목표 마일리지 — 있으면 훈련 계획이 로그 기반 추정 대신 이 값을 따른다 */
  monthlyTargetKm?: Record<string, number>;
}

export interface AthleteProfile {
  maxHr?: number;
  restHr?: number;
}

export interface PaceLabData {
  races: RaceRecord[];
  inbody: InbodyEntry[];
  vo2max: Vo2maxEntry[];
  trainings: Training[];
  upcoming: UpcomingRace | null;
  profile: AthleteProfile;
}

const BLOB_PREFIX = "pacelab/data-";

export const DEFAULT_DATA: PaceLabData = {
  races: [],
  inbody: [],
  vo2max: [],
  trainings: [],
  upcoming: null,
  profile: {},
};

function versionFromPathname(pathname: string): number {
  const m = pathname.match(/data-(\d+)/);
  return m ? Number(m[1]) : 0;
}

function hashId(input: string): string {
  let h = 0;
  for (let i = 0; i < input.length; i++) h = (h * 31 + input.charCodeAt(i)) | 0;
  return "t" + (h >>> 0).toString(36);
}

/** id가 없는 옛 훈련 기록에 내용 기반의 안정적인 id를 부여한다 (저장은 하지 않음) */
function withTrainingIds(trainings: Training[]): Training[] {
  return trainings.map((t) =>
    t.id ? t : { ...t, id: hashId(`${t.date}|${t.distanceKm}|${t.time}|${t.avgHr ?? ""}|${t.note ?? ""}`) }
  );
}

/**
 * blob은 존재하는데 그 내용을 신뢰할 수 없을 때(다운로드 실패, JSON 파싱 실패 —
 * 예: Vercel의 봇 방어 "Security Checkpoint" HTML이 대신 내려온 경우) 던진다.
 * 이 경우를 "blob이 하나도 없는 최초 상태"와 절대 같은 값(null/빈 데이터)으로
 * 취급하면 안 된다 — 그러면 mutateData가 "데이터 없음"으로 오인해 기존 데이터를
 * 빈 값으로 덮어써버린다. 실제로 이 문제로 실 데이터가 유실된 사고가 있었다.
 */
export class DataUnavailableError extends Error {}

/**
 * 매 저장마다 새 버전 경로(타임스탬프)에 쓰고, 항상 최신 버전을 찾아 읽는다.
 *
 * 이전에는 고정 경로("pacelab/data.json")를 덮어쓰는 방식이었는데, Vercel Blob의
 * CDN 엣지 캐시가 경로를 키로 삼기 때문에 overwrite 직후에도 짧게는 수십 초간
 * 이전 내용을 반환할 수 있었다 — "방금 입력한 훈련이 안 보인다"는 증상의 원인이었다.
 * 매번 새 경로에 쓰면 그 URL은 이전에 캐시된 적이 없으므로 항상 최신 내용을
 * 즉시 읽을 수 있다. list()는 CDN이 아니라 Blob 제어 평면 API라 강한 일관성을 갖는다.
 *
 * blob이 "하나도 없음"(진짜 최초 상태)은 null을 반환해 안전하게 처리하지만,
 * blob은 있는데 내용을 못 믿을 상황은 DataUnavailableError를 던져 호출자가
 * 절대 "빈 데이터"로 착각하지 않게 한다.
 */
async function getLatestVersion(): Promise<{ data: PaceLabData; version: number } | null> {
  const { blobs } = await list({ prefix: BLOB_PREFIX, limit: 30 });
  if (blobs.length === 0) return null;
  const latest = blobs.reduce((a, b) => (versionFromPathname(a.pathname) > versionFromPathname(b.pathname) ? a : b));
  const version = versionFromPathname(latest.pathname);
  const res = await fetch(latest.downloadUrl, { cache: "no-store" });
  if (!res.ok) {
    throw new DataUnavailableError(`최신 데이터를 불러오지 못했습니다 (HTTP ${res.status}).`);
  }
  const text = await res.text();
  let parsed: Partial<PaceLabData>;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new DataUnavailableError(
      "최신 데이터 응답이 올바른 JSON이 아닙니다 (Vercel 보안 체크포인트 등 일시적 차단으로 추정)."
    );
  }
  const merged: PaceLabData = { ...DEFAULT_DATA, ...parsed };
  merged.trainings = withTrainingIds(merged.trainings);
  return { data: merged, version };
}

/**
 * 읽기 전용 조회. 실패하면(진짜 빈 상태가 아니라 일시적 오류여도) 화면이 완전히
 * 죽는 것보다는 빈 데이터를 보여주는 쪽을 택하되, 반드시 서버 로그를 남긴다 —
 * "왜 안 보이지"를 나중에 추적할 수 있게. 실제 데이터를 지울 위험이 있는 저장
 * 경로(mutateData)는 이 폴백을 쓰지 않는다.
 */
export async function getData(): Promise<PaceLabData> {
  try {
    const latest = await getLatestVersion();
    return latest ? latest.data : DEFAULT_DATA;
  } catch (err) {
    console.error("[store] getData 실패 — 빈 데이터로 폴백:", err);
    return DEFAULT_DATA;
  }
}

async function saveData(data: PaceLabData): Promise<void> {
  const version = Date.now();
  // 같은 밀리초에 저장이 겹치면(예: 벌크 백필의 동시 요청) 경로가 충돌해 쓰기 자체가
  // 실패할 수 있어, 무작위 접미사를 더해 사실상 충돌 가능성을 없앤다. 앞자리 숫자만
  // 버전으로 파싱하므로(versionFromPathname) 정렬 로직에는 영향이 없다.
  const suffix = Math.random().toString(36).slice(2, 8);
  await put(`${BLOB_PREFIX}${version}-${suffix}.json`, JSON.stringify(data, null, 2), {
    access: "public",
    addRandomSuffix: false,
    contentType: "application/json",
  });

  // 오래된 버전 정리 (최근 3개만 유지) — 실패해도 다음 저장 때 다시 시도되므로 무시
  try {
    const { blobs } = await list({ prefix: BLOB_PREFIX, limit: 50 });
    const sorted = blobs.sort((a, b) => versionFromPathname(b.pathname) - versionFromPathname(a.pathname));
    const stale = sorted.slice(3);
    if (stale.length > 0) await del(stale.map((b) => b.url));
  } catch {
    // ignore cleanup failure
  }
}

const LOCK_PATH = "pacelab/.lock";
const LOCK_STALE_MS = 20_000; // 이보다 오래된 락은 죽은 프로세스가 남긴 것으로 보고 강제 해제
const LOCK_RETRY_BASE_MS = 120;
const LOCK_MAX_WAIT_MS = 15_000;

/**
 * Vercel Blob의 "이미 존재하는 경로엔 addRandomSuffix:false + allowOverwrite 미지정 시
 * 쓰기가 실패한다"는 성질을 원시적인 뮤텍스로 활용한다 — 락 파일을 만들 수 있으면
 * 락 획득, 이미 있으면(=다른 요청이 쓰는 중) 실패로 보고 잠시 후 재시도한다.
 * 락 파일 안에는 획득 시각을 적어두고, 그 시각이 너무 오래됐으면(요청이 중간에
 * 죽어 락을 못 지운 경우) 죽은 락으로 간주해 강제로 지우고 다시 시도한다.
 */
async function acquireLock(): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < LOCK_MAX_WAIT_MS) {
    try {
      await put(LOCK_PATH, String(Date.now()), {
        access: "public",
        addRandomSuffix: false,
        contentType: "text/plain",
      });
      return;
    } catch {
      // 락 획득 실패 — 이미 있는 락이 죽은(오래된) 것인지 확인
      try {
        const { blobs } = await list({ prefix: LOCK_PATH, limit: 1 });
        const lockBlob = blobs.find((b) => b.pathname === LOCK_PATH);
        if (lockBlob) {
          const res = await fetch(lockBlob.downloadUrl, { cache: "no-store" });
          const acquiredAt = Number(await res.text());
          if (!Number.isFinite(acquiredAt) || Date.now() - acquiredAt > LOCK_STALE_MS) {
            await del(lockBlob.url);
            continue; // 죽은 락 정리 후 즉시 재시도
          }
        }
      } catch {
        // 확인 실패는 무시하고 아래에서 잠시 대기 후 재시도
      }
      await new Promise((r) => setTimeout(r, LOCK_RETRY_BASE_MS + Math.random() * 150));
    }
  }
  throw new Error("다른 요청이 저장 중이라 대기 시간이 초과됐습니다. 잠시 후 다시 시도해주세요.");
}

async function releaseLock(): Promise<void> {
  try {
    const { blobs } = await list({ prefix: LOCK_PATH, limit: 1 });
    const lockBlob = blobs.find((b) => b.pathname === LOCK_PATH);
    if (lockBlob) await del(lockBlob.url);
  } catch {
    // 다음 락 획득 시 stale 판정으로 정리되므로 무시
  }
}

/**
 * 데이터를 안전하게 수정한다 (락 기반 상호 배제).
 *
 * 예전에는 API 라우트마다 "읽기 → 메모리에서 수정 → 통째로 저장" 방식이었다.
 * 이 방식은 짧은 시간에 여러 요청이 겹치면(예: 가민 백필 스크립트가 밀린 한 달치
 * 활동을 연속/병렬로 POST) 나중에 끝난 요청이 먼저 끝난 요청의 저장 내용을 통째로
 * 덮어써 그 사이 추가된 항목이 조용히 사라질 수 있었다 — "데이터를 새로 넣었는데
 * 불러와지지 않는다"는 증상의 원인이었다. (버전 재확인만 하는 낙관적 동시성 제어는
 * 재확인과 실제 저장 사이에 여전히 틈이 있어 동시 요청 20개 중 대부분이 유실되는
 * 것을 실측으로 확인 — 그래서 락 방식으로 교체했다.)
 *
 * 락을 잡은 뒤에만 최신 데이터를 읽고 mutator를 적용해 저장하므로, 한 번에 오직
 * 하나의 요청만 읽기-수정-쓰기를 수행한다.
 */
export async function mutateData(mutator: (data: PaceLabData) => void): Promise<PaceLabData> {
  await acquireLock();
  try {
    const latest = await getLatestVersion();
    const data: PaceLabData = latest ? latest.data : { ...DEFAULT_DATA };
    mutator(data);
    await saveData(data);
    return data;
  } finally {
    await releaseLock();
  }
}
