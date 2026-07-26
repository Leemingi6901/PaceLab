"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  parseTime,
  formatPace,
  gradeAdjustedPace,
  classifyIntensity,
  type Prediction,
} from "@/lib/predict";
import type { Training } from "@/lib/store";

interface Props {
  trainings: Training[];
  predictions: Prediction[];
}

interface EditForm {
  date: string;
  distanceKm: string;
  time: string;
  avgHr: string;
  elevGainM: string;
  elevLossM: string;
  note: string;
}

function toForm(t: Training): EditForm {
  return {
    date: t.date,
    distanceKm: String(t.distanceKm),
    time: t.time,
    avgHr: t.avgHr ? String(t.avgHr) : "",
    elevGainM: String(t.elevGainM ?? 0),
    elevLossM: String(t.elevLossM ?? 0),
    note: t.note ?? "",
  };
}

const ZONE_CLASS: Record<string, string> = {
  이지: "zone-easy",
  마라톤: "zone-marathon",
  템포: "zone-tempo",
  인터벌: "zone-interval",
  레페티션: "zone-rep",
  "—": "",
};

export default function TrainingLog({ trainings, predictions }: Props) {
  const router = useRouter();
  const [pin, setPin] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<EditForm | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  const recent = [...trainings].reverse().slice(0, 8);

  function requirePin(): boolean {
    if (!pin.trim()) {
      setMsg({ kind: "err", text: "먼저 상단에 인증번호를 입력하세요." });
      return false;
    }
    return true;
  }

  function startEdit(t: Training) {
    if (!requirePin()) return;
    setEditingId(t.id);
    setForm(toForm(t));
    setMsg(null);
  }

  function cancelEdit() {
    setEditingId(null);
    setForm(null);
  }

  async function saveEdit(id: string) {
    if (!form) return;
    if (!requirePin()) return;
    setBusyId(id);
    setMsg(null);
    try {
      const res = await fetch("/api/data", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          pin,
          type: "training",
          id,
          entry: {
            date: form.date,
            distanceKm: Number(form.distanceKm),
            time: form.time,
            avgHr: form.avgHr || undefined,
            elevGainM: form.elevGainM || 0,
            elevLossM: form.elevLossM || 0,
            note: form.note || undefined,
          },
        }),
      });
      const json = await res.json();
      if (res.ok) {
        setMsg({ kind: "ok", text: "수정됐습니다." });
        setEditingId(null);
        setForm(null);
        router.refresh();
      } else {
        setMsg({ kind: "err", text: json.error ?? "수정에 실패했습니다." });
      }
    } catch {
      setMsg({ kind: "err", text: "네트워크 오류가 발생했습니다." });
    } finally {
      setBusyId(null);
    }
  }

  async function remove(id: string) {
    if (!requirePin()) return;
    if (!confirm("이 훈련 기록을 삭제할까요?")) return;
    setBusyId(id);
    setMsg(null);
    try {
      const res = await fetch("/api/data", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pin, type: "training", id }),
      });
      const json = await res.json();
      if (res.ok) {
        setMsg({ kind: "ok", text: "삭제됐습니다." });
        router.refresh();
      } else {
        setMsg({ kind: "err", text: json.error ?? "삭제에 실패했습니다." });
      }
    } catch {
      setMsg({ kind: "err", text: "네트워크 오류가 발생했습니다." });
    } finally {
      setBusyId(null);
    }
  }

  if (trainings.length === 0) {
    return (
      <div className="pl-note">
        아직 훈련 기록이 없습니다. <a href="/admin">데이터 입력</a>에서 첫 훈련을 추가해보세요.
      </div>
    );
  }

  return (
    <div>
      <div className="pl-pin-inline">
        <input
          type="password"
          inputMode="numeric"
          value={pin}
          onChange={(e) => setPin(e.target.value)}
          placeholder="수정/삭제 인증번호"
          autoComplete="off"
        />
        {msg && <span className={`pl-msg-inline ${msg.kind}`}>{msg.text}</span>}
      </div>
      <div className="pl-table-wrap">
        <table className="pl-table">
          <thead>
            <tr>
              <th>날짜</th>
              <th>거리</th>
              <th>시간</th>
              <th>페이스</th>
              <th>고도</th>
              <th>강도</th>
              <th>심박</th>
              <th>메모</th>
              <th>관리</th>
            </tr>
          </thead>
          <tbody>
            {recent.map((t) => {
              const gain = t.elevGainM ?? 0;
              const loss = t.elevLossM ?? 0;
              const gap = gradeAdjustedPace(parseTime(t.time), t.distanceKm, gain, loss);
              const zone = classifyIntensity(gap, predictions);
              const isEditing = editingId === t.id;

              if (isEditing && form) {
                return (
                  <tr key={t.id} className="pl-row-editing">
                    <td>
                      <input type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} />
                    </td>
                    <td>
                      <input
                        type="number"
                        step="0.01"
                        value={form.distanceKm}
                        onChange={(e) => setForm({ ...form, distanceKm: e.target.value })}
                        style={{ width: 70 }}
                      />
                    </td>
                    <td>
                      <input
                        value={form.time}
                        onChange={(e) => setForm({ ...form, time: e.target.value })}
                        placeholder="58:30"
                        style={{ width: 70 }}
                      />
                    </td>
                    <td>
                      <span className="pl-edit-hint">자동계산</span>
                    </td>
                    <td>
                      <div className="pl-edit-elev">
                        <input
                          type="number"
                          min="0"
                          value={form.elevGainM}
                          onChange={(e) => setForm({ ...form, elevGainM: e.target.value })}
                          placeholder="▲m"
                          style={{ width: 55 }}
                        />
                        <input
                          type="number"
                          min="0"
                          value={form.elevLossM}
                          onChange={(e) => setForm({ ...form, elevLossM: e.target.value })}
                          placeholder="▼m"
                          style={{ width: 55 }}
                        />
                      </div>
                    </td>
                    <td>
                      <span className="pl-edit-hint">자동계산</span>
                    </td>
                    <td>
                      <input
                        type="number"
                        value={form.avgHr}
                        onChange={(e) => setForm({ ...form, avgHr: e.target.value })}
                        placeholder="bpm"
                        style={{ width: 55 }}
                      />
                    </td>
                    <td>
                      <input value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} style={{ width: 100 }} />
                    </td>
                    <td>
                      <div className="pl-row-actions">
                        <button className="pl-icon-btn ok" disabled={busyId === t.id} onClick={() => saveEdit(t.id)}>
                          저장
                        </button>
                        <button className="pl-icon-btn" disabled={busyId === t.id} onClick={cancelEdit}>
                          취소
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              }

              return (
                <tr key={t.id}>
                  <td>{t.date}</td>
                  <td>{t.distanceKm}km</td>
                  <td>{t.time}</td>
                  <td>{formatPace(parseTime(t.time) / t.distanceKm)}/km</td>
                  <td>
                    {gain === 0 && loss === 0 ? (
                      "—"
                    ) : (
                      <>
                        <span className="up">▲{gain}m</span> <span className="down">▼{loss}m</span>
                      </>
                    )}
                  </td>
                  <td>
                    <span className={`pl-zone ${ZONE_CLASS[zone]}`}>{zone}</span>
                  </td>
                  <td>{t.avgHr ? `${t.avgHr}bpm` : "—"}</td>
                  <td>{t.note ?? "—"}</td>
                  <td>
                    <div className="pl-row-actions">
                      <button className="pl-icon-btn" disabled={busyId === t.id} onClick={() => startEdit(t)}>
                        수정
                      </button>
                      <button className="pl-icon-btn danger" disabled={busyId === t.id} onClick={() => remove(t.id)}>
                        삭제
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
