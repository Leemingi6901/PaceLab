import type { TrainingPlanData } from "@/lib/trainingPlan";

interface Props {
  plan: TrainingPlanData;
}

function isCurrentWeek(startDate: string): boolean {
  const start = new Date(startDate + "T00:00:00").getTime();
  const end = start + 7 * 86400000;
  const now = Date.now();
  return now >= start && now < end;
}

export default function TrainingPlan({ plan }: Props) {
  const { totalWeeks, phaseWeeks, startWeeklyKm, peakWeeklyKm, startLongRunKm, peakLongRunKm, idealPeakLongRunKm, weeks } =
    plan;
  const fallsShort = peakLongRunKm < idealPeakLongRunKm - 0.5;

  return (
    <div>
      <div className="pl-plan-summary">
        <span>
          <b>{totalWeeks}주</b> 계획
        </span>
        <span>
          기초 {phaseWeeks.base}주 · 빌드업 {phaseWeeks.build}주 · 피크 {phaseWeeks.peak}주 · 테이퍼 {phaseWeeks.taper}주
        </span>
        <span>
          주간거리 <b>{startWeeklyKm.toFixed(1)}km</b> → <b>{peakWeeklyKm.toFixed(1)}km</b>
        </span>
        <span>
          롱런 <b>{startLongRunKm}km</b> → <b>{peakLongRunKm}km</b>
        </span>
      </div>
      {fallsShort && (
        <div className="pl-note">
          대회 거리 기준 이론상 목표 롱런은 {idealPeakLongRunKm}km인데, 지금 로그된 훈련량으로 안전하게(주간
          총량의 {Math.round(0.45 * 100)}% 이내) {totalWeeks}주 안에 도달 가능한 최대는 {peakLongRunKm}km예요.
          더 긴 롱런을 넣으려면 지금부터 주간 훈련량 자체를 늘리거나(실제로 더 뛰고 계신다면 훈련 기록을
          꼼꼼히 남겨주세요), 대회까지 준비 기간을 더 여유 있게 잡는 걸 권장해요.
        </div>
      )}
      <div className="pl-table-wrap">
        <table className="pl-table pl-plan-table">
          <thead>
            <tr>
              <th>주차</th>
              <th>시작일</th>
              <th>단계</th>
              <th>목표 거리</th>
              <th>롱런</th>
              <th>핵심 세션</th>
            </tr>
          </thead>
          <tbody>
            {weeks.map((w) => (
              <tr
                key={w.weekIndex}
                className={[isCurrentWeek(w.startDate) ? "pl-plan-current" : "", w.isCutback ? "pl-plan-cutback" : ""]
                  .filter(Boolean)
                  .join(" ")}
              >
                <td>
                  {w.weekIndex}주차{w.isRaceWeek ? " (대회)" : ""}
                </td>
                <td>{w.startDate}</td>
                <td>
                  <span className={`pl-badge pl-phase-${w.phase}`}>{w.phase}</span>
                  {w.isCutback && <span className="pl-badge pl-cutback-badge">컷백</span>}
                </td>
                <td>{w.targetKm}km</td>
                <td>{w.longRunKm}km</td>
                <td className="pl-plan-sessions">{w.sessions.join(" · ")}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
