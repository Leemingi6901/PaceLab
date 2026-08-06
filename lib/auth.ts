import { NextResponse } from "next/server";

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function verifyPin(pin: unknown): Promise<{ ok: true } | { ok: false; res: NextResponse }> {
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
