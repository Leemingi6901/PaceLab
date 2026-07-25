import { put } from "@vercel/blob";
import racesJson from "@/data/races.json";
import inbodyJson from "@/data/inbody.json";
import upcomingJson from "@/data/upcoming.json";
import type { RaceRecord, InbodyEntry, CourseSegment } from "./predict";

export interface Training {
  date: string;
  distanceKm: number;
  time: string; // "MM:SS" | "H:MM:SS"
  avgHr?: number;
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
  upcoming: UpcomingRace;
}

const BLOB_PATH = "pacelab/data.json";

export const DEFAULT_DATA: PaceLabData = {
  races: racesJson.records,
  inbody: inbodyJson.measurements,
  trainings: [],
  upcoming: upcomingJson.race as UpcomingRace,
};

/** 토큰(vercel_blob_rw_<storeId>_<secret>)에서 스토어 공개 호스트를 유도 */
function blobBaseUrl(): string | null {
  const token = process.env.BLOB_READ_WRITE_TOKEN;
  const storeId = token?.split("_")[3];
  if (!storeId) return null;
  return `https://${storeId.toLowerCase()}.public.blob.vercel-storage.com`;
}

/**
 * Blob에서 데이터 로드. 없거나 실패하면 저장소의 기본(샘플) 데이터.
 * list() SDK 호출은 개발 서버에서 캐시되는 문제가 있어, 고정 경로 URL을
 * 타임스탬프 쿼리로 캐시버스팅하며 직접 fetch한다.
 */
export async function getData(): Promise<PaceLabData> {
  const base = blobBaseUrl();
  if (!base) return DEFAULT_DATA;
  try {
    const res = await fetch(`${base}/${BLOB_PATH}?ts=${Date.now()}`, { cache: "no-store" });
    if (!res.ok) return DEFAULT_DATA;
    const parsed = (await res.json()) as Partial<PaceLabData>;
    return { ...DEFAULT_DATA, ...parsed };
  } catch {
    return DEFAULT_DATA;
  }
}

export async function saveData(data: PaceLabData): Promise<void> {
  await put(BLOB_PATH, JSON.stringify(data, null, 2), {
    access: "public",
    addRandomSuffix: false,
    allowOverwrite: true,
    contentType: "application/json",
    cacheControlMaxAge: 60,
  });
}
