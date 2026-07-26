import type { RaceRecord } from "@/lib/predict";
import type { Training } from "@/lib/store";

interface Props {
  races: RaceRecord[];
  trainings: Training[];
}

interface DayCell {
  day: number;
  dateStr: string;
  km: number;
  hasRace: boolean;
}

const WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"];

export default function MonthlyMileage({ races, trainings }: Props) {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth(); // 0-indexed
  const monthLabel = `${year}년 ${month + 1}월`;

  const dayMap = new Map<string, { km: number; hasRace: boolean }>();
  const addEntry = (dateStr: string, km: number, isRace: boolean) => {
    const cur = dayMap.get(dateStr) ?? { km: 0, hasRace: false };
    cur.km += km;
    if (isRace) cur.hasRace = true;
    dayMap.set(dateStr, cur);
  };
  for (const t of trainings) addEntry(t.date, t.distanceKm, false);
  for (const r of races) addEntry(r.date, r.distanceKm, true);

  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const startWeekday = new Date(year, month, 1).getDay(); // 0=Sun

  const cells: (DayCell | null)[] = Array(startWeekday).fill(null);
  let monthTotalKm = 0;
  let monthRaceDays = 0;
  let maxDayKm = 0;
  let activeDays = 0;

  for (let d = 1; d <= daysInMonth; d++) {
    const dateStr = `${year}-${String(month + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    const entry = dayMap.get(dateStr);
    const km = entry?.km ?? 0;
    monthTotalKm += km;
    if (entry?.hasRace) monthRaceDays++;
    if (km > 0) activeDays++;
    if (km > maxDayKm) maxDayKm = km;
    cells.push({ day: d, dateStr, km, hasRace: entry?.hasRace ?? false });
  }

  const todayStr = `${year}-${String(month + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;

  return (
    <div className="pl-calendar">
      <div className="pl-calendar-head">
        <div>
          <h3>{monthLabel}</h3>
          <span className="pl-calendar-sub">
            활동 {activeDays}일{monthRaceDays > 0 ? ` · 대회 ${monthRaceDays}회 포함` : ""}
          </span>
        </div>
        <div className="pl-calendar-total">
          <b>{monthTotalKm.toFixed(1)}</b>
          <small>km 이번 달 누적</small>
        </div>
      </div>
      <div className="pl-cal-grid pl-cal-weekdays">
        {WEEKDAYS.map((w) => (
          <div key={w} className="pl-cal-weekday">
            {w}
          </div>
        ))}
      </div>
      <div className="pl-cal-grid">
        {cells.map((c, i) => {
          if (!c) return <div key={`empty-${i}`} className="pl-cal-cell empty" />;
          const intensity = maxDayKm > 0 ? Math.min(1, c.km / maxDayKm) : 0;
          const isToday = c.dateStr === todayStr;
          const cls = ["pl-cal-cell"];
          if (c.km > 0) cls.push("active");
          if (isToday) cls.push("today");
          if (c.hasRace) cls.push("race");
          return (
            <div
              key={c.dateStr}
              className={cls.join(" ")}
              style={c.km > 0 ? ({ "--intensity": intensity } as React.CSSProperties) : undefined}
            >
              <span className="pl-cal-day">{c.day}</span>
              {c.km > 0 && <span className="pl-cal-km">{Number.isInteger(c.km) ? c.km : c.km.toFixed(1)}</span>}
              {c.hasRace && <span className="pl-cal-race-dot" title="대회일" />}
            </div>
          );
        })}
      </div>
    </div>
  );
}
