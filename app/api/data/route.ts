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

const TIME_RE = /^(\d+:)?[0-5]?\d:[0-5]\d$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export async function POST(req: Request) {
  let body: { pin?: string; type?: string; entry?: Record<string, unknown> };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "잘못된 요청입니다." }, { status: 400 });
  }

  const adminPin = process.env.ADMIN_PIN;
  if (!adminPin) {
    return NextResponse.json({ error: "서버에 인증번호가 설정되지 않았습니다." }, { status: 500 });
  }

  // 무차별 대입을 조금이라도 늦추기 위한 지연
  await new Promise((r) => setTimeout(r, 400));

  if (typeof body.pin !== "string" || !timingSafeEqual(body.pin, adminPin)) {
    return NextResponse.json({ error: "인증번호가 올바르지 않습니다." }, { status: 401 });
  }

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
      const e = entry as unknown as Training;
      if (!DATE_RE.test(e.date) || !TIME_RE.test(e.time) || !(Number(e.distanceKm) > 0)) {
        throw new Error("날짜(YYYY-MM-DD)/거리/시간(MM:SS 또는 H:MM:SS)을 확인하세요.");
      }
      data.trainings.push({
        date: e.date,
        distanceKm: Number(e.distanceKm),
        time: e.time,
        avgHr: e.avgHr ? Number(e.avgHr) : undefined,
        note: e.note ? String(e.note) : undefined,
      });
      data.trainings.sort((a, b) => a.date.localeCompare(b.date));
    } else {
      throw new Error("알 수 없는 type입니다.");
    }
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "검증 실패" }, { status: 400 });
  }

  await saveData(data);
  return NextResponse.json({ ok: true });
}
