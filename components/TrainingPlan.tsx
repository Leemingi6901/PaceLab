import type { TrainingPlanData } from "@/lib/trainingPlan";

interface Props {
  plan: TrainingPlanData;
}

function fmtDate(dateStr: string): string {
  const [, m, d] = dateStr.split("-");
  return `${Number(m)}/${Number(d)}`;
}

export default function TrainingPlan({ plan }: Props) {
  const { totalWeeks, totalPlanKm, phasePeriods } = plan;

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
        {phasePeriods.map((p, i) => (
          <li key={i}>
            <span className={`pl-badge pl-phase-${p.phase}`}>{p.phase}</span>
            <span className="pl-phase-range">
              {fmtDate(p.startDate)} ~ {fmtDate(p.endDate)} ({p.weeks}주)
            </span>
            <span className="pl-phase-km">누적 약 {p.totalKm}km</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
