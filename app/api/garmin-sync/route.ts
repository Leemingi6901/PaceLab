import { NextResponse } from "next/server";
import { verifyPin } from "@/lib/auth";

export const dynamic = "force-dynamic";

const GH_REPO = "Leemingi6901/PaceLab";
const WORKFLOW_FILE = "garmin-sync.yml";

/**
 * "가민 데이터 불러오기" 버튼 — GitHub Actions의 garmin-sync 워크플로우를 즉시 1회 실행시킨다.
 * 실제 가민 로그인/동기화는 여기서 하지 않는다(Vercel에서 직접 하려면 curl_cffi급 TLS 우회가
 * 필요해 GitHub Actions에 이미 그 파이프라인이 있음 — 이 라우트는 그걸 깨우기만 한다).
 * GitHub REST API의 workflow_dispatch는 트리거만 하고 즉시 204를 반환하므로, 실제로 데이터가
 * 반영되기까지는 워크플로우 실행 시간(보통 15~30초)만큼 걸린다.
 */
export async function POST(req: Request) {
  let body: { pin?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "잘못된 요청입니다." }, { status: 400 });
  }

  const auth = await verifyPin(body.pin);
  if (!auth.ok) return auth.res;

  const token = process.env.GH_DISPATCH_TOKEN;
  if (!token) {
    return NextResponse.json({ error: "서버에 GH_DISPATCH_TOKEN이 설정되지 않았습니다." }, { status: 500 });
  }

  const res = await fetch(`https://api.github.com/repos/${GH_REPO}/actions/workflows/${WORKFLOW_FILE}/dispatches`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
    },
    body: JSON.stringify({ ref: "main" }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    return NextResponse.json({ error: `GitHub Actions 트리거 실패 (${res.status}): ${text.slice(0, 200)}` }, { status: 502 });
  }

  return NextResponse.json({ ok: true });
}
