import {
  predictAll,
  predictCourseSplits,
  recommendWorkouts,
  getRunnerTier,
  parseTime,
  formatTime,
  formatPace,
} from "@/lib/predict";
import { getData } from "@/lib/store";
import { buildLoadSeries, summarizeLoad, estimateFitness } from "@/lib/trainingLoad";
import { buildTrainingPlan } from "@/lib/trainingPlan";
import TrainingLog from "@/components/TrainingLog";
import MonthlyMileage from "@/components/MonthlyMileage";
import TrainingLoad from "@/components/TrainingLoad";
import CourseElevation from "@/components/CourseElevation";
import TrainingPlan from "@/components/TrainingPlan";

export const dynamic = "force-dynamic";

function EmptyNote({ children }: { children: React.ReactNode }) {
  return <div className="pl-note">{children}</div>;
}

export default async function Home() {
  const data = await getData();
  const { races, inbody, vo2max, trainings, upcoming, profile } = data;

  const loadSeries = buildLoadSeries(races, inbody, trainings);
  const loadSummary = summarizeLoad(loadSeries);
  const fit = estimateFitness(races, inbody, loadSeries, vo2max);
  const predictions = predictAll(fit);
  const course = upcoming ? predictCourseSplits(fit, upcoming) : null;
  const plan = upcoming
    ? buildTrainingPlan(upcoming.date, upcoming.distanceKm, trainings, upcoming.monthlyTargetKm)
    : null;
  const maxHr = profile.maxHr ?? (Math.max(0, ...races.map((r) => r.maxHr ?? 0)) || undefined);
  const restHr = profile.restHr;
  const workouts = recommendWorkouts(trainings, predictions, loadSummary?.tsb, maxHr, restHr);
  const tier = fit ? getRunnerTier(fit.weightAdjustedVdot) : null;
  const latestInbody = inbody[inbody.length - 1];

  const maxW = Math.max(...inbody.map((m) => m.weightKg), 1);
  const maxF = Math.max(...inbody.map((m) => m.bodyFatPct), 1);
  const maxM = Math.max(...inbody.map((m) => m.muscleKg), 1);

  const now = Date.now();
  const inLastDays = (dateStr: string, days: number) => now - new Date(dateStr).getTime() < days * 86400000;
  const weekTrainings = trainings.filter((t) => inLastDays(t.date, 7));
  const monthTrainings = trainings.filter((t) => inLastDays(t.date, 30));
  const weekKm = weekTrainings.reduce((s, t) => s + t.distanceKm, 0);
  const monthKm = monthTrainings.reduce((s, t) => s + t.distanceKm, 0);
  const weekGain = weekTrainings.reduce((s, t) => s + (t.elevGainM ?? 0), 0);
  const monthGain = monthTrainings.reduce((s, t) => s + (t.elevGainM ?? 0), 0);

  return (
    <div>
      <header className="pl-header">
        <a href="/" className="pl-logo">
          Pace<span>Lab</span>
        </a>
        <nav>
          <a href="#prediction">Prediction</a>
          <a href="#records">Records</a>
          <a href="#condition">Condition</a>
          <a href="#training">Training</a>
          <a href="#mileage">Mileage</a>
          <a href="#load">Load</a>
          <a href="#nextworkout">Workout</a>
          <a href="#plan">Plan</a>
          <a href="#nextrace">Next Race</a>
        </nav>
      </header>

      {/* 히어로 */}
      <section className="pl-hero">
        <p className="pl-hello">마라톤 훈련 AI 분석 랩</p>
        <h1>
          Pace<em>Lab</em>
        </h1>
        <p className="pl-tagline">
          공식 대회 기록 × 인바디 데이터로 현재 체력을 추정하고,
          <br />
          다음 대회의 PB와 구간 기록을 예측합니다. — 가민 165 · 서울
        </p>
        <div className="pl-fitness">
          {fit && tier ? (
            <>
              <div className={`pl-stat pl-stat-tier pl-tier-${tier.tier}`}>
                <small>글로벌 러너 티어</small>
                <b className="pl-tier-name">{tier.tier}</b>
                <small>{tier.percentileLabel}</small>
              </div>
              <div className="pl-stat">
                <small>현재 추정 VDOT</small>
                <b className="hl">{fit.weightAdjustedVdot.toFixed(1)}</b>
                <small>
                  {Math.abs(fit.combinedFactor - 1) < 0.005
                    ? "체중 보정 적용"
                    : `체중·훈련량 반영 ${fit.combinedFactor >= 1 ? "+" : ""}${((fit.combinedFactor - 1) * 100).toFixed(1)}%`}
                </small>
              </div>
              <div className="pl-stat">
                <small>기준 최고 기록</small>
                <b>{fit.baseRace.time}</b>
                <small>{fit.baseRace.race}</small>
              </div>
              <div className="pl-stat">
                <small>현재 체중</small>
                <b>{fit.latestWeight}kg</b>
                <small>
                  {latestInbody ? `골격근 ${latestInbody.muscleKg}kg · 체지방 ${latestInbody.bodyFatPct}%` : `기록 당시 ${fit.baseWeight}kg`}
                </small>
              </div>
            </>
          ) : (
            <div className="pl-stat">
              <small>데이터 없음</small>
              <b>—</b>
              <small>
                <a href="/admin">대회 기록을 입력</a>하면 분석이 시작됩니다
              </small>
            </div>
          )}
          <div className="pl-stat">
            <small>최근 7일 / 30일 주행</small>
            <b>
              {weekKm.toFixed(1)}
              <small>km</small> / {monthKm.toFixed(1)}
              <small>km</small>
            </b>
            <small>
              ▲ {weekGain.toFixed(0)}m / {monthGain.toFixed(0)}m 누적 상승
            </small>
          </div>
        </div>

        {predictions.length > 0 && (
          <div className="pl-hero-pb" id="prediction">
            <div className="pl-grid">
              {predictions.map((p) => (
                <div key={p.label} className="pl-card pl-pred">
                  <span className="pl-badge">{p.label}</span>
                  <div className="pl-time pl-time-range">
                    {formatTime(p.lowSec)} ~ {formatTime(p.highSec)}
                  </div>
                  <span className="pl-sub">
                    {formatTime(p.timeSec)} 확률 가장 높음 · {formatPace(p.paceSecPerKm)}/km
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </section>

      {/* 01 공식 기록 */}
      <section className="pl-section" id="records">
        <span className="pl-eyebrow">01 — OFFICIAL RECORDS</span>
        <h2>
          공식 대회 <em>기록</em>
        </h2>
        <p className="pl-section-desc">칩 타임 기준 공식 기록. 이 데이터가 모든 예측의 출발점입니다.</p>
        {races.length === 0 ? (
          <EmptyNote>
            아직 기록이 없습니다. <a href="/admin">데이터 입력</a>에서 첫 공식 기록을 추가하세요.
          </EmptyNote>
        ) : (
          <div className="pl-grid">
            {races.map((r) => (
              <div key={`${r.race}-${r.date}`} className="pl-card">
                <h3>{r.race}</h3>
                <span className="pl-date">{r.date}</span>
                <div className="pl-time">{r.time}</div>
                <span className="pl-sub">
                  {r.distanceKm}km · {formatPace(parseTime(r.time) / r.distanceKm)}/km
                  {r.weightKg ? ` · ${r.weightKg}kg` : ""}
                  {r.maxHr ? ` · 최대심박 ${r.maxHr}bpm` : ""}
                </span>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* 02 인바디 */}
      <section className="pl-section" id="condition">
        <span className="pl-eyebrow">02 — BODY CONDITION</span>
        <h2>
          인바디 <em>추이</em>
        </h2>
        <p className="pl-section-desc">
          체중이 내려가면 상대 VO2max가 올라갑니다. 최근 측정값이 예측의 체중 보정에 반영됩니다.
        </p>
        {inbody.length === 0 ? (
          <EmptyNote>
            아직 측정값이 없습니다. <a href="/admin">데이터 입력</a>에서 인바디 결과를 추가하세요.
          </EmptyNote>
        ) : (
          <>
            <div className="pl-inbody">
              {inbody.map((m) => (
                <div key={m.date} className="pl-inbody-col">
                  <div className="pl-bars">
                    <div className="pl-bar pl-bar-w" style={{ height: `${(m.weightKg / maxW) * 100}%` }} />
                    <div className="pl-bar pl-bar-f" style={{ height: `${(m.bodyFatPct / maxF) * 100}%` }} />
                    <div className="pl-bar pl-bar-m" style={{ height: `${(m.muscleKg / maxM) * 100}%` }} />
                  </div>
                  <div className="pl-vals">
                    {m.weightKg}kg · {m.bodyFatPct}% · {m.muscleKg}kg
                  </div>
                  <small>{m.date}</small>
                </div>
              ))}
            </div>
            <div className="pl-legend">
              <span>
                <i style={{ background: "var(--accent)" }} />
                체중
              </span>
              <span>
                <i style={{ background: "var(--accent2)" }} />
                체지방률
              </span>
              <span>
                <i style={{ background: "var(--accent3)" }} />
                골격근량
              </span>
            </div>
          </>
        )}
      </section>

      {/* 03 훈련 로그 */}
      <section className="pl-section" id="training">
        <span className="pl-eyebrow">03 — TRAINING LOG</span>
        <h2>
          러닝 <em>훈련 기록</em>
        </h2>
        <p className="pl-section-desc">
          서울 인근 훈련 기록. 최근 8회를 보여줍니다. 고도 보정 페이스(GAP)로 업/다운힐을 반영해 훈련 강도를
          자동 분류하고, 그날의 컨디션(TSB)에 이 강도가 맞았는지 + 페이스·심박이 그 강도를 얼마나 정확히
          찍었는지를 종합해 100점 만점 훈련 점수를 매깁니다. 점수에 마우스를 올리면 평가 근거가 보입니다.
        </p>
        <TrainingLog trainings={trainings} predictions={predictions} loadSeries={loadSeries} maxHr={maxHr} restHr={restHr} />
      </section>

      {/* 04 월간 마일리지 */}
      <section className="pl-section" id="mileage">
        <span className="pl-eyebrow">04 — MONTHLY MILEAGE</span>
        <h2>
          이번 달 <em>러닝 마일리지</em>
        </h2>
        <p className="pl-section-desc">대회와 훈련 기록을 날짜 기준으로 합산합니다. 대회일은 점으로 표시됩니다.</p>
        <MonthlyMileage races={races} trainings={trainings} />
      </section>

      {/* 05 훈련 부하 */}
      <section className="pl-section" id="load">
        <span className="pl-eyebrow">05 — TRAINING LOAD</span>
        <h2>
          훈련 부하 <em>&amp; 컨디션</em>
        </h2>
        <p className="pl-section-desc">
          Banister 임펄스-반응 모델. 세션마다 시간×강도² 기반 부하를 구해 체력(CTL, 42일 지수평활)과
          피로도(ATL, 7일 지수평활)를 매일 갱신하고, 그 차이(TSB)로 오늘의 컨디션을 판단합니다.
        </p>
        {!loadSummary ? (
          <EmptyNote>공식 대회 기록과 훈련 기록이 있어야 훈련 부하를 계산할 수 있습니다.</EmptyNote>
        ) : (
          <TrainingLoad summary={loadSummary} />
        )}
      </section>

      {/* 06 다음 훈련 추천 */}
      <section className="pl-section" id="nextworkout">
        <span className="pl-eyebrow">06 — NEXT WORKOUT</span>
        <h2>
          다음 훈련 <em>추천</em>
        </h2>
        <p className="pl-section-desc">
          최근 훈련 강도·간격과 이번 주 훈련량을 바탕으로 난이도별 3가지를 제안합니다. 하나는 지금 시점에
          가장 적합한 &quot;추천&quot;으로 표시됩니다.
        </p>
        {!workouts ? (
          <EmptyNote>훈련 기록과 공식 대회 기록이 있어야 추천을 받을 수 있습니다.</EmptyNote>
        ) : (
          <div className="pl-grid">
            {workouts.map((w) => (
              <div key={w.level} className={`pl-card pl-workout${w.recommended ? " pl-workout-pick" : ""}`}>
                {w.recommended && <span className="pl-pick-badge">지금 추천</span>}
                <span className={`pl-badge pl-level-${w.level}`}>난이도 {w.level}</span>
                <h3>{w.title}</h3>
                <p className="pl-workout-structure">{w.structure}</p>
                <div className="pl-workout-stats">
                  <span>{w.distanceKm}km</span>
                  <span>{formatPace(w.paceSecPerKm)}/km</span>
                </div>
                {w.hrGuidance && (
                  <div className="pl-workout-hr">
                    <span className="pl-badge pl-hr-badge">{w.hrZone}</span> {w.hrGuidance}
                  </div>
                )}
                {w.segments && (
                  <ul className="pl-workout-segments">
                    {w.segments.map((s, i) => (
                      <li key={i}>
                        <span className="pl-seg-range">{s.range}</span>
                        <span className="pl-seg-pace">{formatPace(s.paceSecPerKm)}/km</span>
                        <span className="pl-seg-note">{s.note}</span>
                      </li>
                    ))}
                  </ul>
                )}
                <p className="pl-workout-reason">{w.reason}</p>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* 07 주기화 훈련 계획 */}
      <section className="pl-section" id="plan">
        <span className="pl-eyebrow">07 — TRAINING PLAN</span>
        <h2>
          대회까지 <em>주기화 훈련 계획</em>
        </h2>
        <p className="pl-section-desc">
          대회일까지 남은 기간을 달(월)별로 나눠 누적 목표 마일리지를 보여줍니다. 관리 페이지에서 월별
          목표를 직접 입력하면 그 값을 그대로 반영하고, 입력하지 않은 달은 최근 4주 평균 주행거리를 기준으로
          점진적으로(주당 최대 +8%) 늘려가는 안전한 성장 곡선으로 추정합니다.
        </p>
        {!upcoming ? (
          <EmptyNote>
            예정 대회가 있어야 훈련 계획을 짤 수 있습니다. <a href="/admin">데이터 입력</a>에서 등록하세요.
          </EmptyNote>
        ) : !plan ? (
          <EmptyNote>대회 날짜가 이미 지났습니다.</EmptyNote>
        ) : (
          <TrainingPlan plan={plan} />
        )}
      </section>

      {/* 08 다음 대회 */}
      <section className="pl-section" id="nextrace">
        <span className="pl-eyebrow">08 — NEXT RACE</span>
        <h2>
          다음 대회 <em>구간 전략</em>
        </h2>
        <p className="pl-section-desc">
          코스 고도 데이터(상승 10m당 +9초, 하강 10m당 −4초)와 후반 감속 드리프트(최대 +4%)를 반영한 구간별 예상
          기록입니다.
        </p>
        {!upcoming ? (
          <EmptyNote>
            예정 대회가 없습니다. <a href="/admin">데이터 입력</a>에서 다음 대회를 등록하세요.
          </EmptyNote>
        ) : !course ? (
          <EmptyNote>공식 대회 기록이 1개 이상 있어야 구간 예측이 가능합니다.</EmptyNote>
        ) : (
          <>
            <div className="pl-race-head">
              <div>
                <h3>{upcoming.name}</h3>
                <span className="pl-date">
                  {upcoming.date} · {upcoming.location}
                  {upcoming.courseNote ? ` · ${upcoming.courseNote}` : ""}
                </span>
              </div>
              <div>
                <small style={{ color: "var(--muted)" }}>예상 완주</small>
                <div className="pl-total pl-total-range">
                  {formatTime(course.lowSec)} ~ {formatTime(course.highSec)}
                </div>
                <small style={{ color: "var(--muted)" }}>{formatTime(course.totalSec)} 확률 가장 높음</small>
              </div>
            </div>
            {upcoming.elevationProfile && upcoming.elevationProfile.length >= 2 && (
              <CourseElevation profile={upcoming.elevationProfile} distanceKm={upcoming.distanceKm} />
            )}
            <div className="pl-table-wrap">
              <table className="pl-table">
                <thead>
                  <tr>
                    <th>구간</th>
                    <th>고도</th>
                    <th>예상 페이스</th>
                    <th>구간 기록</th>
                    <th>누적</th>
                  </tr>
                </thead>
                <tbody>
                  {course.splits.map((s) => (
                    <tr key={s.fromKm}>
                      <td>
                        {s.fromKm}–{s.toKm}km
                      </td>
                      <td>
                        <span className="up">▲{s.elevGain}m</span>{" "}
                        <span className="down">▼{Math.abs(s.elevLoss)}m</span>
                      </td>
                      <td>{formatPace(s.paceSecPerKm)}/km</td>
                      <td>{formatTime(s.segmentSec)}</td>
                      <td>{formatTime(s.cumulativeSec)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </section>

      <footer className="pl-footer">
        © 2026 PaceLab — Daniel의 마라톤 훈련 분석 랩 · <a href="/admin">데이터 입력</a>
      </footer>
    </div>
  );
}
