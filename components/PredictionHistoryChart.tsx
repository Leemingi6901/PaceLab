"use client";

import { useMemo, useState } from "react";
import { formatTime } from "@/lib/predict";
import { predictionHistoryForDistance, type FitnessHistoryPoint } from "@/lib/trainingLoad";

interface Props {
  history: FitnessHistoryPoint[];
}

const DISTANCES: { label: string; km: number }[] = [
  { label: "5K", km: 5 },
  { label: "10K", km: 10 },
  { label: "하프(21K)", km: 21.0975 },
  { label: "풀코스(42K)", km: 42.195 },
];

const W = 640;
const H = 160;
const PAD_X = 6;
const PAD_Y = 10;

export default function PredictionHistoryChart({ history }: Props) {
  const [tab, setTab] = useState(0);
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);
  const dist = DISTANCES[tab];

  const points = useMemo(() => predictionHistoryForDistance(history, dist.km), [history, dist.km]);

  if (points.length < 2) {
    return (
      <div className="pl-predhist">
        <div className="pl-predhist-tabs">
          {DISTANCES.map((d, i) => (
            <button
              key={d.label}
              type="button"
              className={`pl-predhist-tab ${i === tab ? "active" : ""}`}
              onClick={() => {
                setTab(i);
                setHoverIdx(null);
              }}
            >
              {d.label}
            </button>
          ))}
        </div>
        <div className="pl-note">데이터가 더 쌓이면 예측 변동 추이가 여기 표시됩니다.</div>
      </div>
    );
  }

  const times = points.map((p) => p.timeSec);
  const min = Math.min(...times);
  const max = Math.max(...times);
  const range = max - min || 1;
  const stepX = (W - PAD_X * 2) / (points.length - 1);
  const xAt = (i: number) => PAD_X + i * stepX;
  // 빠른 기록(=더 좋음)일수록 위로 — 개선 추세가 그래프에서 "올라가는" 것으로 보이도록
  const yAt = (t: number) => PAD_Y + (H - PAD_Y * 2) * (t - min) / range;

  const path = points.map((p, i) => `${i === 0 ? "M" : "L"}${xAt(i).toFixed(1)},${yAt(p.timeSec).toFixed(1)}`).join(" ");
  const changeIdxs = points.reduce<number[]>((acc, p, i) => {
    if (p.reasons.length > 0) acc.push(i);
    return acc;
  }, []);

  const hover = hoverIdx !== null ? points[hoverIdx] : null;
  const first = points[0];
  const last = points[points.length - 1];
  const overallDeltaSec = last.timeSec - first.timeSec;

  function handleMove(e: React.MouseEvent<HTMLDivElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    const frac = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
    const svgX = frac * W;
    const idx = Math.round((svgX - PAD_X) / stepX);
    setHoverIdx(Math.min(points.length - 1, Math.max(0, idx)));
  }

  return (
    <div className="pl-predhist">
      <div className="pl-predhist-tabs">
        {DISTANCES.map((d, i) => (
          <button
            key={d.label}
            type="button"
            className={`pl-predhist-tab ${i === tab ? "active" : ""}`}
            onClick={() => {
              setTab(i);
              setHoverIdx(null);
            }}
          >
            {d.label}
          </button>
        ))}
      </div>

      <div className="pl-predhist-summary">
        <span>
          {first.date} → {last.date}
        </span>
        <span className={overallDeltaSec <= 0 ? "faster" : "slower"}>
          {overallDeltaSec === 0 ? "변화 없음" : `${overallDeltaSec < 0 ? "▼" : "▲"} ${formatTime(Math.abs(overallDeltaSec))}`}
        </span>
      </div>

      <div className="pl-predhist-chart" onMouseMove={handleMove} onMouseLeave={() => setHoverIdx(null)}>
        <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none">
          <path d={path} className="pl-predhist-line" />
          {changeIdxs.map((i) => (
            <circle key={i} cx={xAt(i)} cy={yAt(points[i].timeSec)} r={3} className="pl-predhist-dot" />
          ))}
          {hoverIdx !== null && (
            <line x1={xAt(hoverIdx)} x2={xAt(hoverIdx)} y1={0} y2={H} className="pl-predhist-cursor" />
          )}
        </svg>

        {hover && (
          <div
            className={`pl-predhist-tooltip ${xAt(hoverIdx!) > W * 0.65 ? "align-right" : xAt(hoverIdx!) < W * 0.35 ? "align-left" : ""}`}
            style={{ left: `${(xAt(hoverIdx!) / W) * 100}%` }}
          >
            <div className="pl-predhist-tooltip-date">{hover.date}</div>
            <div className="pl-predhist-tooltip-time">{formatTime(hover.timeSec)}</div>
            {hover.reasons.length > 0 ? (
              <ul>
                {hover.reasons.map((r, ri) => (
                  <li key={ri}>{r}</li>
                ))}
              </ul>
            ) : (
              <div className="pl-predhist-tooltip-flat">변화 없음</div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
