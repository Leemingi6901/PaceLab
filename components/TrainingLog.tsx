"use client";

import { Fragment, useState } from "react";
import { useRouter } from "next/navigation";
import {
  parseTime,
  formatPace,
  effectiveTimeSec,
  gradeAdjustedPace,
  resolveIntensity,
  zoneBandLabel,
  type IntensityZone,
  type Prediction,
} from "@/lib/predict";
import { scoreTrainings } from "@/lib/trainingLoad";
import type { Training } from "@/lib/store";

interface Props {
  trainings: Training[];
  predictions: Prediction[];
  maxHr?: number;
  restHr?: number;
}

interface EditForm {
  date: string;
  distanceKm: string;
  time: string;
  avgHr: string;
  elevGainM: string;
  elevLossM: string;
  treadmill: boolean;
  note: string;
  /** 빈 문자열이면 자동 분류 */
  intensityOverride: string;
}

const INTENSITY_OPTIONS: IntensityZone[] = ["이지", "보통", "하드"];

function toForm(t: Training): EditForm {
  return {
    date: t.date,
    distanceKm: String(t.distanceKm),
    time: t.time,
    avgHr: t.avgHr ? String(t.avgHr) : "",
    elevGainM: String(t.elevGainM ?? 0),
    elevLossM: String(t.elevLossM ?? 0),
    treadmill: t.treadmill ?? false,
    note: t.note ?? "",
    intensityOverride: t.intensityOverride ?? "",
  };
}

const ZONE_CLASS: Record<string, string> = {
  이지: "zone-easy",
  보통: "zone-normal",
  하드: "zone-hard",
  "—": "",
};

function scoreClass(score: number): string {
  if (score >= 85) return "score-great";
  if (score >= 70) return "score-good";
  if (score >= 50) return "score-fair";
  return "score-poor";
}

const PAGE_SIZE = 4;

export default function TrainingLog({ trainings, predictions, maxHr, restHr }: Props) {
  const router = useRouter();
  const [pin, setPin] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<EditForm | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [page, setPage] = useState(0);

  function refresh() {
    setRefreshing(true);
    router.refresh();
    setTimeout(() => setRefreshing(false), 600);
  }

  const sorted = [...trainings].reverse();
  const totalPages = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages - 1);
  const recent = sorted.slice(currentPage * PAGE_SIZE, currentPage * PAGE_SIZE + PAGE_SIZE);
  const scores = scoreTrainings(trainings, predictions, maxHr, restHr);

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
            treadmill: form.treadmill,
            note: form.note || undefined,
            intensityOverride: form.intensityOverride || undefined,
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
        <button type="button" className="pl-icon-btn" onClick={refresh} disabled={refreshing}>
          {refreshing ? "새로고침 중…" : "↻ 새로고침"}
        </button>
        {msg && <span className={`pl-msg-inline ${msg.kind}`}>{msg.text}</span>}
      </div>
      <div className="pl-table-wrap">
        <table className="pl-table">
          <thead>
            <tr>
              <th>날짜</th>
              <th>거리</th>
              <th>시간</th>
              <th>페이스(보정)</th>
              <th>고도</th>
              <th>강도</th>
              <th>점수</th>
              <th>심박</th>
              <th>메모</th>
              <th>관리</th>
            </tr>
          </thead>
          <tbody>
            {recent.map((t) => {
              const gain = t.elevGainM ?? 0;
              const loss = t.elevLossM ?? 0;
              const correctedSec = effectiveTimeSec(parseTime(t.time), t.treadmill);
              const correctedPace = correctedSec / t.distanceKm;
              const gap = gradeAdjustedPace(correctedSec, t.distanceKm, gain, loss);
              const zone = resolveIntensity(gap, predictions, t.intensityOverride, t.avgHr, maxHr, restHr);
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
                      <label className="pl-checkbox pl-checkbox-sm">
                        <input
                          type="checkbox"
                          checked={form.treadmill}
                          onChange={(e) => setForm({ ...form, treadmill: e.target.checked })}
                        />
                        <span>트레드밀</span>
                      </label>
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
                      <select
                        value={form.intensityOverride}
                        onChange={(e) => setForm({ ...form, intensityOverride: e.target.value })}
                        style={{ width: 80 }}
                      >
                        <option value="">자동</option>
                        {INTENSITY_OPTIONS.map((z) => (
                          <option key={z} value={z}>
                            {z}
                          </option>
                        ))}
                      </select>
                      <div className="pl-zone-bands">
                        {INTENSITY_OPTIONS.map((z) => {
                          const label = zoneBandLabel(z, predictions);
                          return label ? (
                            <span key={z}>
                              {z} {label}
                            </span>
                          ) : null;
                        })}
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

              const score = scores.get(t.id);
              const isExpanded = expandedId === t.id;

              return (
                <Fragment key={t.id}>
                  <tr>
                    <td>{t.date}</td>
                    <td>{t.distanceKm}km</td>
                    <td>
                      {t.time}
                      {t.treadmill && <span className="pl-treadmill-tag">트레드밀</span>}
                    </td>
                    <td>{formatPace(correctedPace)}/km</td>
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
                      <span className={`pl-zone ${ZONE_CLASS[zone]}`} title={t.intensityOverride ? "직접 지정한 강도" : "자동 분류"}>
                        {zone}
                        {t.intensityOverride && <span className="pl-zone-manual">✎</span>}
                      </span>
                    </td>
                    <td>
                      {!score ? (
                        "—"
                      ) : (
                        <button
                          type="button"
                          className={`pl-score-badge ${scoreClass(score.score)}`}
                          onClick={() => setExpandedId(isExpanded ? null : t.id)}
                        >
                          {score.score}점 {isExpanded ? "▲" : "▾"}
                        </button>
                      )}
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
                  {isExpanded && score && (
                    <tr className="pl-detail-row">
                      <td colSpan={10}>
                        <div className="pl-score-detail">
                          <div className="pl-score-detail-head">
                            <span className={`pl-score-badge lg ${scoreClass(score.score)}`}>{score.score}점</span>
                            <span className="pl-score-sub">"{score.zone}" 강도 기준 페이스 정확도</span>
                          </div>
                          <div className="pl-score-detail-cols">
                            <div>
                              <h4>왜 이 점수인가요</h4>
                              <ul>
                                {score.breakdown.map((b, i) => (
                                  <li key={i}>{b}</li>
                                ))}
                              </ul>
                            </div>
                            <div>
                              <h4>더 높은 점수를 받으려면</h4>
                              <ul className="pl-suggest-list">
                                {score.suggestions.map((s, i) => (
                                  <li key={i}>{s}</li>
                                ))}
                              </ul>
                            </div>
                          </div>
                        </div>
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
      {totalPages > 1 && (
        <div className="pl-pager">
          <button
            type="button"
            className="pl-icon-btn"
            disabled={currentPage === 0}
            onClick={() => setPage(currentPage - 1)}
          >
            ← 최근
          </button>
          <span className="pl-pager-status">
            {currentPage + 1} / {totalPages} 페이지 ({sorted.length}건)
          </span>
          <button
            type="button"
            className="pl-icon-btn"
            disabled={currentPage >= totalPages - 1}
            onClick={() => setPage(currentPage + 1)}
          >
            이전 →
          </button>
        </div>
      )}
    </div>
  );
}
