import type { LoadSummary } from "@/lib/trainingLoad";

interface Props {
  summary: LoadSummary;
}

function linePath(values: number[], width: number, height: number, min: number, max: number): string {
  const range = max - min || 1;
  const stepX = values.length > 1 ? width / (values.length - 1) : 0;
  return values
    .map((v, i) => {
      const x = i * stepX;
      const y = height - ((v - min) / range) * height;
      return `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
}

const STATUS_CLASS: Record<LoadSummary["status"], string> = {
  "매우 높은 피로": "pl-load-danger",
  "피로 누적": "pl-load-warn",
  균형: "pl-load-ok",
  "컨디션 좋음": "pl-load-fresh",
  "테이퍼 · 완전 회복": "pl-load-fresh",
};

export default function TrainingLoad({ summary }: Props) {
  const { ctl, atl, tsb, status, trend } = summary;
  const W = 640;
  const H = 130;
  const ctlVals = trend.map((p) => p.ctl);
  const atlVals = trend.map((p) => p.atl);
  const min = Math.min(0, ...ctlVals, ...atlVals);
  const max = Math.max(1, ...ctlVals, ...atlVals);

  return (
    <>
      <div className="pl-fitness pl-load-stats">
        <div className="pl-stat">
          <small>체력 (CTL)</small>
          <b className="hl">{ctl.toFixed(1)}</b>
          <small>42일 지수평활 훈련부하</small>
        </div>
        <div className="pl-stat">
          <small>피로도 (ATL)</small>
          <b>{atl.toFixed(1)}</b>
          <small>7일 지수평활 훈련부하</small>
        </div>
        <div className={`pl-stat pl-load-tsb ${STATUS_CLASS[status]}`}>
          <small>폼 (TSB = CTL − ATL)</small>
          <b>
            {tsb > 0 ? "+" : ""}
            {tsb.toFixed(1)}
          </b>
          <small>{status}</small>
        </div>
      </div>
      <div className="pl-load-chart">
        <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none">
          <path d={linePath(atlVals, W, H, min, max)} className="pl-load-line-atl" />
          <path d={linePath(ctlVals, W, H, min, max)} className="pl-load-line-ctl" />
        </svg>
      </div>
      <div className="pl-legend">
        <span>
          <i style={{ background: "var(--accent)" }} />
          체력 (CTL)
        </span>
        <span>
          <i style={{ background: "var(--accent2)" }} />
          피로도 (ATL)
        </span>
      </div>
    </>
  );
}
