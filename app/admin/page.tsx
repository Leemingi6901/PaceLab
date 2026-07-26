"use client";

import { useState } from "react";

type Msg = { kind: "ok" | "err"; text: string } | null;

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="pl-field">
      <span>{label}</span>
      {children}
    </label>
  );
}

export default function AdminPage() {
  const [pin, setPin] = useState("");
  const [msg, setMsg] = useState<Msg>(null);
  const [busy, setBusy] = useState(false);

  async function submit(type: string, form: HTMLFormElement) {
    setBusy(true);
    setMsg(null);
    const fd = new FormData(form);
    const entry = Object.fromEntries(
      Array.from(fd.entries()).filter(([, v]) => String(v).trim() !== "")
    );
    try {
      const res = await fetch("/api/data", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pin, type, entry }),
      });
      const json = await res.json();
      if (res.ok) {
        setMsg({ kind: "ok", text: "저장됐습니다. 메인 페이지에 바로 반영됩니다." });
        form.reset();
      } else {
        setMsg({ kind: "err", text: json.error ?? "저장에 실패했습니다." });
      }
    } catch {
      setMsg({ kind: "err", text: "네트워크 오류가 발생했습니다." });
    } finally {
      setBusy(false);
    }
  }

  const onSubmit = (type: string) => (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    submit(type, e.currentTarget);
  };

  return (
    <div className="pl-admin">
      <header className="pl-header">
        <a href="/" className="pl-logo">
          Pace<span>Lab</span>
        </a>
        <nav>
          <a href="/">← 메인으로</a>
        </nav>
      </header>

      <main className="pl-section" style={{ paddingTop: 130 }}>
        <span className="pl-eyebrow">DATA ENTRY</span>
        <h2>
          데이터 <em>입력</em>
        </h2>
        <p className="pl-section-desc">
          인증번호가 맞아야만 저장됩니다. 저장된 데이터는 서버(Blob)에 보관되어 새로고침·재배포와 무관하게 유지됩니다.
        </p>

        <div className="pl-pinbox">
          <Field label="인증번호">
            <input
              type="password"
              inputMode="numeric"
              value={pin}
              onChange={(e) => setPin(e.target.value)}
              placeholder="****"
              autoComplete="off"
            />
          </Field>
          {msg && <p className={`pl-msg ${msg.kind === "ok" ? "ok" : "err"}`}>{msg.text}</p>}
        </div>

        <div className="pl-forms">
          <form className="pl-form" onSubmit={onSubmit("race")}>
            <h3>🏁 공식 대회 기록</h3>
            <Field label="대회명 *">
              <input name="race" required placeholder="2026 춘천마라톤" />
            </Field>
            <Field label="날짜 *">
              <input name="date" required type="date" />
            </Field>
            <Field label="거리(km) *">
              <input name="distanceKm" required type="number" step="0.0001" placeholder="10 / 21.0975 / 42.195" />
            </Field>
            <Field label="기록 *">
              <input name="time" required placeholder="45:50 또는 3:38:00" pattern="^(\d+:)?[0-5]?\d:[0-5]\d$" />
            </Field>
            <Field label="당시 체중(kg)">
              <input name="weightKg" type="number" step="0.1" placeholder="70.5" />
            </Field>
            <Field label="최대 심박수(bpm)">
              <input name="maxHr" type="number" placeholder="185" />
            </Field>
            <Field label="메모">
              <input name="note" placeholder="네거티브 스플릿 성공" />
            </Field>
            <button disabled={busy}>{busy ? "저장 중…" : "대회 기록 추가"}</button>
          </form>

          <form className="pl-form" onSubmit={onSubmit("inbody")}>
            <h3>💪 인바디</h3>
            <Field label="날짜 *">
              <input name="date" required type="date" />
            </Field>
            <Field label="체중(kg) *">
              <input name="weightKg" required type="number" step="0.1" placeholder="70.0" />
            </Field>
            <Field label="체지방률(%)">
              <input name="bodyFatPct" type="number" step="0.1" placeholder="15.0" />
            </Field>
            <Field label="골격근량(kg)">
              <input name="muscleKg" type="number" step="0.1" placeholder="33.5" />
            </Field>
            <button disabled={busy}>{busy ? "저장 중…" : "인바디 추가"}</button>
          </form>

          <form className="pl-form" onSubmit={onSubmit("training")}>
            <h3>👟 러닝 훈련</h3>
            <Field label="날짜 *">
              <input name="date" required type="date" />
            </Field>
            <Field label="거리(km) *">
              <input name="distanceKm" required type="number" step="0.01" placeholder="12.5" />
            </Field>
            <Field label="시간 *">
              <input name="time" required placeholder="58:30 또는 1:02:10" pattern="^(\d+:)?[0-5]?\d:[0-5]\d$" />
            </Field>
            <Field label="평균 심박(bpm)">
              <input name="avgHr" type="number" placeholder="152" />
            </Field>
            <Field label="총 상승(m)">
              <input name="elevGainM" type="number" step="1" min="0" placeholder="0" />
            </Field>
            <Field label="총 하강(m)">
              <input name="elevLossM" type="number" step="1" min="0" placeholder="0" />
            </Field>
            <Field label="메모">
              <input name="note" placeholder="한강 LSD, 잠실 인터벌…" />
            </Field>
            <button disabled={busy}>{busy ? "저장 중…" : "훈련 기록 추가"}</button>
          </form>

          <form className="pl-form" onSubmit={onSubmit("upcoming")}>
            <h3>🎯 예정 대회 (기존 등록을 대체)</h3>
            <Field label="대회명 *">
              <input name="name" required placeholder="2026 춘천마라톤" />
            </Field>
            <Field label="날짜 *">
              <input name="date" required type="date" />
            </Field>
            <Field label="거리(km) *">
              <input name="distanceKm" required type="number" step="0.0001" placeholder="42.195" />
            </Field>
            <Field label="지역">
              <input name="location" placeholder="강원 춘천시" />
            </Field>
            <Field label="코스 특징">
              <input name="courseNote" placeholder="전반 완만, 후반 언덕" />
            </Field>
            <button disabled={busy}>{busy ? "저장 중…" : "예정 대회 등록"}</button>
          </form>
        </div>
      </main>

      <footer className="pl-footer">© 2026 PaceLab</footer>
    </div>
  );
}
