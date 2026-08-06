import type { TrainingPlanData } from "@/lib/trainingPlan";

interface Props {
  plan: TrainingPlanData;
}

function fmtMonth(month: string): string {
  const [, m] = month.split("-");
  return `${Number(m)}월`;
}

export default function TrainingPlan({ plan }: Props) {
  const { totalWeeks, totalPlanKm, monthlyPeriods } = plan;

  return (
    <div>
      <div className="pl-plan-summary">
        <span>
          <b>{totalWeeks}주</b> 계획
        </span>
        <span>
          대회일까지 누적 약 <b>{totalPlanKm}km</b>
        </span>
      </div>
      <ul className="pl-plan-phases">
        {monthlyPeriods.map((p) => (
          <li key={p.month}>
            <span className="pl-badge pl-month-badge">{fmtMonth(p.month)}</span>
            <span className="pl-phase-range">{p.weeks}주 포함</span>
            <span className="pl-phase-km">
              {p.totalKm}km
              {p.targetKm !== undefined && <span className="pl-phase-target"> / 목표 {p.targetKm}km</span>}
              {p.loggedKm !== undefined && (
                <span className="pl-phase-target">
                  {" "}
                  · {p.loggedKm}km 완료, {Math.max(0, Math.round((p.totalKm - p.loggedKm) * 10) / 10)}km 남음
                </span>
              )}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
