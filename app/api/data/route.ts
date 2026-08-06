import { NextResponse } from "next/server";
import { getData, saveData, type PaceLabData, type Training } from "@/lib/store";
import { segmentsFromProfile, parseTime, type RaceRecord, type InbodyEntry, type ElevationPoint, type IntensityZone } from "@/lib/predict";
import { verifyPin } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json(await getData());
}

const TIME_RE = /^(\d+:)?[0-5]?\d:[0-5]\d$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function num(v: unknown): number | undefined {
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : undefined;
}

const INTENSITY_ZONES: IntensityZone[] = ["이지", "보통", "하드"];

function intensityOverride(v: unknown): IntensityZone | undefined {
  return INTENSITY_ZONES.includes(v as IntensityZone) ? (v as IntensityZone) : undefined;
}

function buildTraining(e: Record<string, unknown>): Omit<Training, "id"> {
  if (!DATE_RE.test(String(e.date)) || !TIME_RE.test(String(e.time)) || !(Number(e.distanceKm) > 0)) {
    throw new Error("날짜(YYYY-MM-DD)/거리/시간(MM:SS 또는 H:MM:SS)을 확인하세요.");
  }
  return {
    date: e.date as string,
    distanceKm: Number(e.distanceKm),
    time: e.time as string,
    avgHr: num(e.avgHr),
    elevGainM: num(e.elevGainM) ?? 0,
    elevLossM: num(e.elevLossM) ?? 0,
    treadmill: e.treadmill === true || e.treadmill === "true" || e.treadmill === "on",
    note: e.note ? String(e.note) : undefined,
    intensityOverride: intensityOverride(e.intensityOverride),
    garminId: e.garminId ? String(e.garminId) : undefined,
  };
}

export async function POST(req: Request) {
  let body: { pin?: string; type?: string; entry?: Record<string, unknown> };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "잘못된 요청입니다." }, { status: 400 });
  }

  const auth = await verifyPin(body.pin);
  if (!auth.ok) return auth.res;

  const { type, entry } = body;
  if (!type || !entry) {
    return NextResponse.json({ error: "type과 entry가 필요합니다." }, { status: 400 });
  }

  const data: PaceLabData = await getData();

  try {
    if (type === "race") {
      const e = entry as unknown as RaceRecord;
      if (!e.race || !DATE_RE.test(e.date) || !TIME_RE.test(e.time) || !(Number(e.distanceKm) > 0)) {
        throw new Error("대회명/날짜(YYYY-MM-DD)/거리/기록(MM:SS 또는 H:MM:SS)을 확인하세요.");
      }
      data.races.push({
        race: String(e.race),
        date: e.date,
        distanceKm: Number(e.distanceKm),
        time: e.time,
        weightKg: e.weightKg ? Number(e.weightKg) : undefined,
        maxHr: num(e.maxHr),
        note: e.note ? String(e.note) : undefined,
      });
      data.races.sort((a, b) => a.date.localeCompare(b.date));
    } else if (type === "inbody") {
      const e = entry as unknown as InbodyEntry;
      if (!DATE_RE.test(e.date) || !(Number(e.weightKg) > 0)) {
        throw new Error("날짜(YYYY-MM-DD)와 체중을 확인하세요.");
      }
      data.inbody.push({
        date: e.date,
        weightKg: Number(e.weightKg),
        bodyFatPct: Number(e.bodyFatPct) || 0,
        muscleKg: Number(e.muscleKg) || 0,
      });
      data.inbody.sort((a, b) => a.date.localeCompare(b.date));
    } else if (type === "vo2max") {
      const e = entry as { date?: string; vo2max?: number };
      const value = num(e.vo2max);
      if (!DATE_RE.test(e.date ?? "") || value === undefined || value <= 0) {
        throw new Error("날짜(YYYY-MM-DD)와 VO2max를 확인하세요.");
      }
      // 같은 날짜 값은 덮어쓴다 (가민 자동 동기화가 하루에 여러 번 같은 날짜를 다시 보낼 수 있음)
      const existingIdx = data.vo2max.findIndex((v) => v.date === e.date);
      if (existingIdx >= 0) data.vo2max[existingIdx] = { date: e.date!, vo2max: value };
      else data.vo2max.push({ date: e.date!, vo2max: value });
      data.vo2max.sort((a, b) => a.date.localeCompare(b.date));
    } else if (type === "profile") {
      const e = entry as { maxHr?: number; restHr?: number };
      const maxHr = num(e.maxHr);
      const restHr = num(e.restHr);
      if (maxHr === undefined && restHr === undefined) {
        throw new Error("최대심박 또는 안정시심박 중 하나는 입력해야 합니다.");
      }
      data.profile = { maxHr, restHr };
    } else if (type === "training") {
      const built = buildTraining(entry);
      // garminId가 있고 이미 저장된 기록이면 새로 추가하지 않고 덮어쓴다 (자동 동기화 중복 방지).
      // garminId가 아직 없는 기존 기록(수동 입력분)이라도 같은 날짜·비슷한 거리·시간이면
      // 같은 활동으로 보고 그 기록에 garminId를 붙여 병합한다 — 그래야 이후 동기화부터
      // 정상적으로 매칭돼 중복이 생기지 않는다.
      let existingIdx = built.garminId ? data.trainings.findIndex((t) => t.garminId === built.garminId) : -1;
      if (existingIdx === -1 && built.garminId) {
        existingIdx = data.trainings.findIndex(
          (t) =>
            !t.garminId &&
            t.date === built.date &&
            Math.abs(t.distanceKm - built.distanceKm) < 0.1 &&
            Math.abs(parseTime(t.time) - parseTime(built.time)) < 60
        );
      }
      if (existingIdx >= 0) {
        data.trainings[existingIdx] = {
          ...data.trainings[existingIdx],
          ...built,
          intensityOverride: data.trainings[existingIdx].intensityOverride ?? built.intensityOverride,
        };
      } else {
        data.trainings.push({ id: crypto.randomUUID(), ...built });
      }
      data.trainings.sort((a, b) => a.date.localeCompare(b.date));
    } else if (type === "upcoming") {
      const e = entry as {
        name?: string;
        date?: string;
        distanceKm?: number;
        location?: string;
        courseNote?: string;
        elevationProfile?: string;
        monthlyTargetKm?: string;
      };
      const dist = Number(e.distanceKm);
      if (!e.name || !DATE_RE.test(e.date ?? "") || !(dist > 0)) {
        throw new Error("대회명/날짜(YYYY-MM-DD)/거리를 확인하세요.");
      }

      // "km,고도m" 한 줄에 하나씩 — 없으면 5km 단위 평지 구간으로 생성
      let elevationProfile: ElevationPoint[] | undefined;
      if (e.elevationProfile) {
        elevationProfile = String(e.elevationProfile)
          .split(/\r?\n/)
          .map((line) => line.split(",").map((s) => Number(s.trim())))
          .filter(([km, elevM]) => Number.isFinite(km) && Number.isFinite(elevM))
          .map(([km, elevM]) => ({ km, elevM }))
          .sort((a, b) => a.km - b.km);
        if (elevationProfile.length < 2) elevationProfile = undefined;
      }

      const segments = elevationProfile
        ? segmentsFromProfile(dist, elevationProfile)
        : Array.from({ length: Math.ceil(dist / 5) }, (_, i) => {
            const from = i * 5;
            const to = Math.min(from + 5, dist);
            return { fromKm: from, toKm: Math.round(to * 1000) / 1000, elevGain: 0, elevLoss: 0 };
          });

      // "YYYY-MM,목표km" 한 줄에 하나씩
      let monthlyTargetKm: Record<string, number> | undefined;
      if (e.monthlyTargetKm) {
        const entries = String(e.monthlyTargetKm)
          .split(/\r?\n/)
          .map((line) => line.split(",").map((s) => s.trim()))
          .filter(([month, km]) => /^\d{4}-\d{2}$/.test(month ?? "") && Number(km) > 0)
          .map(([month, km]) => [month, Number(km)] as const);
        if (entries.length > 0) monthlyTargetKm = Object.fromEntries(entries);
      }

      data.upcoming = {
        name: String(e.name),
        date: e.date!,
        distanceKm: dist,
        location: e.location ? String(e.location) : "",
        courseNote: e.courseNote ? String(e.courseNote) : "",
        segments,
        elevationProfile,
        monthlyTargetKm,
      };
    } else {
      throw new Error("알 수 없는 type입니다.");
    }
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "검증 실패" }, { status: 400 });
  }

  await saveData(data);
  return NextResponse.json({ ok: true });
}

export async function PUT(req: Request) {
  let body: { pin?: string; type?: string; id?: string; entry?: Record<string, unknown> };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "잘못된 요청입니다." }, { status: 400 });
  }

  const auth = await verifyPin(body.pin);
  if (!auth.ok) return auth.res;

  if (body.type !== "training" || !body.id || !body.entry) {
    return NextResponse.json({ error: "id와 entry가 필요합니다." }, { status: 400 });
  }

  const data = await getData();
  const idx = data.trainings.findIndex((t) => t.id === body.id);
  if (idx === -1) {
    return NextResponse.json({ error: "해당 훈련 기록을 찾을 수 없습니다." }, { status: 404 });
  }

  try {
    const built = buildTraining(body.entry);
    data.trainings[idx] = { id: body.id, ...built };
    data.trainings.sort((a, b) => a.date.localeCompare(b.date));
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "검증 실패" }, { status: 400 });
  }

  await saveData(data);
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: Request) {
  let body: { pin?: string; type?: string; id?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "잘못된 요청입니다." }, { status: 400 });
  }

  const auth = await verifyPin(body.pin);
  if (!auth.ok) return auth.res;

  if (body.type !== "training" || !body.id) {
    return NextResponse.json({ error: "id가 필요합니다." }, { status: 400 });
  }

  const data = await getData();
  const before = data.trainings.length;
  data.trainings = data.trainings.filter((t) => t.id !== body.id);
  if (data.trainings.length === before) {
    return NextResponse.json({ error: "해당 훈련 기록을 찾을 수 없습니다." }, { status: 404 });
  }

  await saveData(data);
  return NextResponse.json({ ok: true });
}
