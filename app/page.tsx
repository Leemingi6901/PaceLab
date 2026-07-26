import {
  currentFitness,
  predictAll,
  predictCourseSplits,
  parseTime,
  formatTime,
  formatPace,
} from "@/lib/predict";
import { getData } from "@/lib/store";

export const dynamic = "force-dynamic";

function EmptyNote({ children }: { children: React.ReactNode }) {
  return <div className="pl-note">{children}</div>;
}

export default async function Home() {
  const data = await getData();
  const { races, inbody, trainings, upcoming } = data;

  const fit = currentFitness(races, inbody);
  const predictions = predictAll(races, inbody);
  const course = upcoming ? predictCourseSplits(races, inbody, upcoming) : null;

  const maxW = Math.max(...inbody.map((m) => m.weightKg), 1);
  const maxF = Math.max(...inbody.map((m) => m.bodyFatPct), 1);
  const maxM = Math.max(...inbody.map((m) => m.muscleKg), 1);

  const recentTrainings = [...trainings].reverse().slice(0, 8);
  const now = Date.now();
  const weekKm = trainings
    .filter((t) => now - new Date(t.date).getTime() < 7 * 86400000)
    .reduce((s, t) => s + t.distanceKm, 0);
  const monthKm = trainings
    .filter((t) => now - new Date(t.date).getTime() < 30 * 86400000)
    .reduce((s, t) => s + t.distanceKm, 0);

  return (
    <div>
      <header className="pl-header">
        <a href="/" className="pl-logo">
          Pace<span>Lab</span>
        </a>
        <nav>
          <a href="#records">Records</a>
          <a href="#condition">Condition</a>
          <a href="#training">Training</a>
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
          {fit ? (
            <>
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
            <small>훈련 로그 기준</small>
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
        <p className="pl-section-desc">서울 인근 훈련 기록. 최근 8회를 보여줍니다.</p>
        {recentTrainings.length === 0 ? (
          <EmptyNote>
            아직 훈련 기록이 없습니다. <a href="/admin">데이터 입력</a>에서 첫 훈련을 추가해보세요.
          </EmptyNote>
        ) : (
          <div className="pl-table-wrap">
            <table className="pl-table">
              <thead>
                <tr>
                  <th>날짜</th>
                  <th>거리</th>
                  <th>시간</th>
                  <th>페이스</th>
                  <th>심박</th>
                  <th>메모</th>
                </tr>
              </thead>
              <tbody>
                {recentTrainings.map((t) => (
                  <tr key={`${t.date}-${t.distanceKm}-${t.time}`}>
                    <td>{t.date}</td>
                    <td>{t.distanceKm}km</td>
                    <td>{t.time}</td>
                    <td>{formatPace(parseTime(t.time) / t.distanceKm)}/km</td>
                    <td>{t.avgHr ? `${t.avgHr}bpm` : "—"}</td>
                    <td>{t.note ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* 04 PB 예측 */}
      <section className="pl-section" id="prediction">
        <span className="pl-eyebrow">04 — PB PREDICTION</span>
        <h2>
          거리별 <em>예상 PB</em>
        </h2>
        <p className="pl-section-desc">
          Jack Daniels VDOT 모델 기반. 최근 대회일수록 가중치를 높이고(6개월 반감기), 체중 변화를 ±5% 범위에서
          보정했습니다.
        </p>
        {predictions.length === 0 ? (
          <EmptyNote>공식 대회 기록이 1개 이상 있어야 예측이 가능합니다.</EmptyNote>
        ) : (
          <div className="pl-grid">
            {predictions.map((p) => (
              <div key={p.label} className="pl-card pl-pred">
                <span className="pl-badge">{p.label}</span>
                <div className="pl-time">{formatTime(p.timeSec)}</div>
                <span className="pl-sub">{formatPace(p.paceSecPerKm)}/km 페이스</span>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* 05 다음 대회 */}
      <section className="pl-section" id="nextrace">
        <span className="pl-eyebrow">05 — NEXT RACE</span>
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
        © 2026 PaceLab — Daniel의 마라톤 훈련 분석 랩 ·{" "}
        <a href="https://daniel-tech-wiki-korea97.vercel.app">Daniel.wiki</a> · <a href="/admin">데이터 입력</a>
      </footer>
    </div>
  );
}
