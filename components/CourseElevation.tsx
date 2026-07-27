import type { ElevationPoint } from "@/lib/predict";

interface Props {
  profile: ElevationPoint[];
  distanceKm: number;
}

export default function CourseElevation({ profile, distanceKm }: Props) {
  const W = 640;
  const H = 130;
  const elevs = profile.map((p) => p.elevM);
  const min = Math.min(...elevs);
  const max = Math.max(...elevs);
  const pad = Math.max(5, (max - min) * 0.2);
  const yMin = Math.max(0, min - pad);
  const yMax = max + pad;
  const range = yMax - yMin || 1;

  const toXY = (p: ElevationPoint): [number, number] => [
    (p.km / distanceKm) * W,
    H - ((p.elevM - yMin) / range) * H,
  ];

  const linePoints = profile.map(toXY);
  const lineD = linePoints.map(([x, y], i) => `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
  const areaD = `${lineD} L${W},${H} L0,${H} Z`;

  return (
    <div className="pl-elev-chart">
      <div className="pl-elev-axis-top">
        <span>{Math.round(yMax)}m</span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none">
        <defs>
          <linearGradient id="elevFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#fbbf24" stopOpacity="0.5" />
            <stop offset="100%" stopColor="#fbbf24" stopOpacity="0.02" />
          </linearGradient>
        </defs>
        <path d={areaD} fill="url(#elevFill)" stroke="none" />
        <path d={lineD} className="pl-elev-line" />
      </svg>
      <div className="pl-elev-axis-bottom">
        <span>0km</span>
        <span>{distanceKm}km</span>
      </div>
    </div>
  );
}
