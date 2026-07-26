import { NextResponse } from "next/server";
import { getData, saveData, type PaceLabData, type Training } from "@/lib/store";
import type { RaceRecord, InbodyEntry } from "@/lib/predict";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json(await getData());
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

async function verifyPin(pin: unknown): Promise<{ ok: true } | { ok: false; res: NextResponse }> {
  const adminPin = process.env.ADMIN_PIN;
  if (!adminPin) {
    return { ok: false, res: NextResponse.json({ error: "서버에 인증번호가 설정되지 않았습니다." }, { status: 500 }) };
  }
  // 무차별 대입을 조금이라도 늦추기 위한 지연
  await new Promise((r) => setTimeout(r, 400));
  if (typeof pin !== "string" || !timingSafeEqual(pin, adminPin)) {
    return { ok: false, res: NextResponse.json({ error: "인증번호가 올바르지 않습니다." }, { status: 401 }) };
  }
  return { ok: true };
}

const TIME_RE = /^(\d+:)?[0-5]?\d:[0-5]\d$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function num(v: unknown): number | undefined {
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : undefined;
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
    } else if (type === "training") {
      const built = buildTraining(entry);
      data.trainings.push({ id: crypto.randomUUID(), ...built });
      data.trainings.sort((a, b) => a.date.localeCompare(b.date));
    } else if (type === "upcoming") {
      const e = entry as { name?: string; date?: string; distanceKm?: number; location?: string; courseNote?: string };
      const dist = Number(e.distanceKm);
      if (!e.name || !DATE_RE.test(e.date ?? "") || !(dist > 0)) {
        throw new Error("대회명/날짜(YYYY-MM-DD)/거리를 확인하세요.");
      }
      // 고도 데이터가 없으면 5km 단위 평지 구간으로 생성 (나중에 수정 가능)
      const segments = [];
      for (let from = 0; from < dist; from += 5) {
        const to = Math.min(from + 5, dist);
        segments.push({ fromKm: from, toKm: Math.round(to * 1000) / 1000, elevGain: 0, elevLoss: 0 });
      }
      data.upcoming = {
        name: String(e.name),
        date: e.date!,
        distanceKm: dist,
        location: e.location ? String(e.location) : "",
        courseNote: e.courseNote ? String(e.courseNote) : "",
        segments,
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
