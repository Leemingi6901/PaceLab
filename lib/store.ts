import { put, list, del } from "@vercel/blob";
import type { RaceRecord, InbodyEntry, CourseSegment } from "./predict";

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
}

export interface UpcomingRace {
  name: string;
  date: string;
  distanceKm: number;
  location: string;
  courseNote: string;
  segments: CourseSegment[];
}

export interface PaceLabData {
  races: RaceRecord[];
  inbody: InbodyEntry[];
  trainings: Training[];
  upcoming: UpcomingRace | null;
}

const BLOB_PREFIX = "pacelab/data-";

export const DEFAULT_DATA: PaceLabData = {
  races: [],
  inbody: [],
  trainings: [],
  upcoming: null,
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
 * 매 저장마다 새 버전 경로(타임스탬프)에 쓰고, 항상 최신 버전을 찾아 읽는다.
 *
 * 이전에는 고정 경로("pacelab/data.json")를 덮어쓰는 방식이었는데, Vercel Blob의
 * CDN 엣지 캐시가 경로를 키로 삼기 때문에 overwrite 직후에도 짧게는 수십 초간
 * 이전 내용을 반환할 수 있었다 — "방금 입력한 훈련이 안 보인다"는 증상의 원인이었다.
 * 매번 새 경로에 쓰면 그 URL은 이전에 캐시된 적이 없으므로 항상 최신 내용을
 * 즉시 읽을 수 있다. list()는 CDN이 아니라 Blob 제어 평면 API라 강한 일관성을 갖는다.
 */
export async function getData(): Promise<PaceLabData> {
  try {
    const { blobs } = await list({ prefix: BLOB_PREFIX, limit: 30 });
    if (blobs.length === 0) return DEFAULT_DATA;
    const latest = blobs.reduce((a, b) => (versionFromPathname(a.pathname) > versionFromPathname(b.pathname) ? a : b));
    const res = await fetch(latest.downloadUrl, { cache: "no-store" });
    if (!res.ok) return DEFAULT_DATA;
    const parsed = (await res.json()) as Partial<PaceLabData>;
    const merged: PaceLabData = { ...DEFAULT_DATA, ...parsed };
    merged.trainings = withTrainingIds(merged.trainings);
    return merged;
  } catch {
    return DEFAULT_DATA;
  }
}

export async function saveData(data: PaceLabData): Promise<void> {
  const version = Date.now();
  await put(`${BLOB_PREFIX}${version}.json`, JSON.stringify(data, null, 2), {
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
