import {
  races,
  inbody,
  upcoming,
  currentFitness,
  predictAll,
  predictCourseSplits,
  parseTime,
  formatTime,
  formatPace,
} from "@/lib/predict";

export default function Home() {
  const fit = currentFitness();
  const predictions = predictAll();
  const course = predictCourseSplits();
  const latest = inbody[inbody.length - 1];

  const maxW = Math.max(...inbody.map((m) => m.weightKg));
  const maxF = Math.max(...inbody.map((m) => m.bodyFatPct));
  const maxM = Math.max(...inbody.map((m) => m.muscleKg));

  return (
    <div>
      <header className="pl-header">
        <a href="/" className="pl-logo">
          Pace<span>Lab</span>
        </a>
        <nav>
          <a href="#records">Records</a>
          <a href="#condition">Condition</a>
          <a href="#prediction">Prediction</a>
          <a href="#nextrace">Next Race</a>
          <a href="https://daniel-tech-wiki-korea97.vercel.app">Daniel.wiki ↗</a>
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
          <div className="pl-stat">
            <small>현재 추정 VDOT</small>
            <b className="hl">{fit.weightAdjustedVdot.toFixed(1)}</b>
            <small>체중 보정 적용</small>
          </div>
          <div className="pl-stat">
            <small>기준 최고 기록</small>
            <b>{fit.baseRace.time}</b>
            <small>{fit.baseRace.race}</small>
          </div>
          <div className="pl-stat">
            <small>현재 체중</small>
            <b>{fit.latestWeight}kg</b>
            <small>기록 당시 {fit.baseWeight}kg</small>
          </div>
        </div>
      </section>

      {/* 01 공식 기록 */}
      <section className="pl-section" id="records">
        <span className="pl-eyebrow">01 — OFFICIAL RECORDS</span>
        <h2>
          공식 대회 <em>기록</em>
        </h2>
        <p className="pl-section-desc">칩 타임 기준 공식 기록. 이 데이터가 모든 예측의 출발점입니다.</p>
        <div className="pl-grid">
          {races.map((r) => (
            <div key={r.race} className="pl-card">
              <h3>{r.race}</h3>
              <span className="pl-date">{r.date}</span>
              <div className="pl-time">{r.time}</div>
              <span className="pl-sub">
                {r.distanceKm}km · {formatPace(parseTime(r.time) / r.distanceKm)}/km
                {r.weightKg ? ` · ${r.weightKg}kg` : ""}
              </span>
            </div>
          ))}
        </div>
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
      </section>

      {/* 03 PB 예측 */}
      <section className="pl-section" id="prediction">
        <span className="pl-eyebrow">03 — PB PREDICTION</span>
        <h2>
          거리별 <em>예상 PB</em>
        </h2>
        <p className="pl-section-desc">
          Jack Daniels VDOT 모델 기반. 최근 대회일수록 가중치를 높이고(6개월 반감기), 체중 변화를 ±5% 범위에서
          보정했습니다.
        </p>
        <div className="pl-grid">
          {predictions.map((p) => (
            <div key={p.label} className="pl-card pl-pred">
              <span className="pl-badge">{p.label}</span>
              <div className="pl-time">{formatTime(p.timeSec)}</div>
              <span className="pl-sub">{formatPace(p.paceSecPerKm)}/km 페이스</span>
            </div>
          ))}
        </div>
        <div className="pl-note">
          현재 데이터는 <b>샘플</b>입니다. <code>data/races.json</code>과 <code>data/inbody.json</code>을 실제 기록으로
          바꾸면 모든 예측이 자동 갱신됩니다.
        </div>
      </section>

      {/* 04 다음 대회 */}
      <section className="pl-section" id="nextrace">
        <span className="pl-eyebrow">04 — NEXT RACE</span>
        <h2>
          다음 대회 <em>구간 전략</em>
        </h2>
        <p className="pl-section-desc">
          코스 고도 데이터(상승 10m당 +9초, 하강 10m당 −4초)와 후반 감속 드리프트(최대 +4%)를 반영한 구간별 예상
          기록입니다.
        </p>
        <div className="pl-race-head">
          <div>
            <h3>{upcoming.name}</h3>
            <span className="pl-date">
              {upcoming.date} · {upcoming.location} · {upcoming.courseNote}
            </span>
          </div>
          <div>
            <small style={{ color: "var(--muted)" }}>예상 완주</small>
            <div className="pl-total">{formatTime(course.totalSec)}</div>
          </div>
        </div>
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
                    <span className="up">▲{s.elevGain}m</span> <span className="down">▼{Math.abs(s.elevLoss)}m</span>
                  </td>
                  <td>{formatPace(s.paceSecPerKm)}/km</td>
                  <td>{formatTime(s.segmentSec)}</td>
                  <td>{formatTime(s.cumulativeSec)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="pl-note">
          코스 고도 데이터는 대회 공홈·GPX에서 수집합니다. 반복 수집은 OpenClaw 크롤링 작업으로 자동화할 수 있고,
          수집한 구간 데이터를 <code>data/upcoming.json</code>에 넣으면 전략표가 자동 갱신됩니다.
        </div>
      </section>

      <footer className="pl-footer">
        © 2026 PaceLab — Daniel의 마라톤 훈련 분석 랩 ·{" "}
        <a href="https://daniel-tech-wiki-korea97.vercel.app">Daniel.wiki</a>
      </footer>
    </div>
  );
}
