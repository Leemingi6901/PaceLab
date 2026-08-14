#!/usr/bin/env python3
"""가민 Connect → PaceLab 자동 동기화. GitHub Actions에서 주기적으로 실행된다.

최근 러닝 활동을 PaceLab의 훈련 기록(type=training)으로, 오늘자 VO2max를
type=vo2max로 /api/data에 올린다. 활동은 가민 activityId를 garminId로 함께
보내 같은 활동이 여러 번 실행돼도 중복 저장되지 않고 덮어써진다(서버 쪽
lib/store.ts, app/api/data/route.ts 참고).

로컬 최초 1회는 garmin_login.py로 로그인해 세션 토큰을 만들고, 그 토큰을
GARMIN_TOKENS_B64 시크릿으로 등록해둬야 이 스크립트가 재로그인 없이 동작한다.

필요 환경변수:
  GARMIN_TOKENS_B64  - garmin_login.py가 만든 토큰 디렉터리의 tar+base64 값
  PACELAB_URL        - 예: https://pacelab-korea97.vercel.app
  ADMIN_PIN          - PaceLab 관리자 인증번호 (POST /api/data 인증용)
  SYNC_DAYS_BACK     - (선택) 며칠치 활동을 확인할지, 기본 3
"""

import base64
import io
import json
import os
import sys
import tarfile
import tempfile
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

import requests
from garminconnect import (
    Garmin,
    GarminConnectAuthenticationError,
    GarminConnectConnectionError,
    GarminConnectTooManyRequestsError,
)

TOKEN_DIR = Path(os.path.expanduser("~/.garminconnect"))
CORPORATE_CA = Path(__file__).resolve().parent.parent / "corporate-ca.pem"
KST = timezone(timedelta(hours=9))


def today_kst() -> date:
    """GitHub Actions 러너는 UTC로 동작하지만 가민 활동 날짜는 사용자의 로컬(한국) 날짜
    기준이라, UTC date.today()를 그대로 쓰면 한국 자정~오전 9시 사이엔 그날 뛴 기록이
    조회 범위(end) 밖으로 밀려 동기화가 안 되는 문제가 있었다. KST로 고정해서 계산한다."""
    return datetime.now(KST).date()


def setup_corporate_ca() -> None:
    """사내망 SSL 인터셉션(자체 서명 루트 인증서) 환경이면 curl_cffi/requests가
    신뢰하도록 등록한다. corporate-ca.pem이 없으면(GitHub Actions 등 일반 네트워크)
    아무 것도 하지 않는다."""
    if not CORPORATE_CA.exists():
        return
    import certifi

    combined = Path(tempfile.gettempdir()) / "pacelab_combined_ca.pem"
    combined.write_bytes(Path(certifi.where()).read_bytes() + b"\n" + CORPORATE_CA.read_bytes())
    for var in ("REQUESTS_CA_BUNDLE", "CURL_CA_BUNDLE", "SSL_CERT_FILE"):
        os.environ[var] = str(combined)
    print(f"사내망 SSL 인터셉션 인증서를 신뢰 목록에 추가했습니다 ({CORPORATE_CA.name}).")


def restore_tokens() -> None:
    b64 = os.environ.get("GARMIN_TOKENS_B64")
    if not b64:
        print(
            "GARMIN_TOKENS_B64 환경변수가 없습니다 — 로컬에서 scripts/garmin_login.py를 "
            "먼저 실행해 시크릿을 등록하세요.",
            file=sys.stderr,
        )
        sys.exit(1)
    TOKEN_DIR.mkdir(parents=True, exist_ok=True)
    data = base64.b64decode(b64)
    with tarfile.open(fileobj=io.BytesIO(data), mode="r:gz") as tar:
        tar.extractall(TOKEN_DIR)


def login() -> Garmin:
    restore_tokens()
    api = Garmin()
    try:
        api.login(str(TOKEN_DIR))
    except (GarminConnectAuthenticationError, GarminConnectConnectionError) as e:
        print(f"저장된 토큰으로 로그인 실패: {e}", file=sys.stderr)
        print(
            "토큰이 만료됐을 수 있습니다 — garmin_login.py를 다시 로컬에서 실행해 "
            "GARMIN_TOKENS_B64 시크릿을 갱신하세요.",
            file=sys.stderr,
        )
        sys.exit(1)
    except GarminConnectTooManyRequestsError as e:
        print(f"레이트리밋: {e}", file=sys.stderr)
        sys.exit(1)
    return api


def deep_find_number(obj, key_matches) -> float | None:
    """중첩된 dict/list 안에서 key_matches(key)가 참인 첫 숫자 값을 재귀적으로 찾는다.
    가민의 비공식 API 응답 구조가 계정/기기/시기에 따라 달라질 수 있어, 정확한 키 경로
    대신 이름 패턴으로 유연하게 찾는다."""
    if isinstance(obj, dict):
        for k, v in obj.items():
            if key_matches(k) and isinstance(v, (int, float)) and v:
                return v
        for v in obj.values():
            found = deep_find_number(v, key_matches)
            if found is not None:
                return found
    elif isinstance(obj, list):
        for item in obj:
            found = deep_find_number(item, key_matches)
            if found is not None:
                return found
    return None


def fmt_time(seconds: float) -> str:
    total = round(seconds)
    h, rem = divmod(total, 3600)
    m, s = divmod(rem, 60)
    return f"{h}:{m:02d}:{s:02d}" if h else f"{m}:{s:02d}"


def collect_activities(api: Garmin, race_dates: set[str], days_back: int) -> list[dict]:
    """PaceLab이 이해하는 훈련 entry 딕셔너리 목록을 만들어서 반환만 한다(전송은 호출부에서
    한 번에 배치로). 예전엔 활동마다 개별 POST를 보내서, PaceLab 서버 쪽 저장 한 번(getData
    의 list 1건 + saveData의 put/list 2건 = 3건)이 활동 개수만큼 곱절로 나갔다 — 백필처럼
    한 번에 수십~수백 건을 동기화할 때 Blob Advanced Operations가 순식간에 치솟는 원인이었다.
    지금은 하나로 모아서 배치 엔드포인트에 한 번만 보내므로, 활동이 몇 건이든 저장 비용은
    3건으로 고정된다."""
    start = (today_kst() - timedelta(days=days_back)).isoformat()
    end = today_kst().isoformat()
    activities = api.get_activities_by_date(start, end) or []
    running = [a for a in activities if "running" in (a.get("activityType", {}).get("typeKey") or "")]
    print(f"최근 {days_back}일: 러닝 활동 {len(running)}건 발견")

    entries = []
    for a in running:
        activity_id = a.get("activityId")
        distance_m = a.get("distance") or 0
        duration_s = a.get("duration") or 0
        if not activity_id or distance_m <= 0 or duration_s <= 0:
            continue
        type_key = (a.get("activityType", {}) or {}).get("typeKey", "")
        date_str = (a.get("startTimeLocal") or "").split(" ")[0].split("T")[0]
        if not date_str:
            continue
        if date_str in race_dates:
            print(f"  {date_str} -> 건너뜀 (이미 공식 대회 기록으로 등록된 날짜)")
            continue

        entry = {
            "date": date_str,
            "distanceKm": round(distance_m / 1000, 3),
            "time": fmt_time(duration_s),
            "elevGainM": round(a.get("elevationGain") or 0),
            "elevLossM": round(a.get("elevationLoss") or 0),
            "treadmill": "treadmill" in type_key,
            "garminId": str(activity_id),
        }
        avg_hr = deep_find_number(
            a, lambda k: k.lower() in ("avghr", "averagehr", "avgheartrate", "averageheartrate")
        )
        if avg_hr:
            entry["avgHr"] = round(avg_hr)
        else:
            print(f"  ({date_str} 평균심박을 응답에서 못 찾음: {json.dumps(a, ensure_ascii=False)[:300]})")
        if a.get("activityName"):
            entry["note"] = f"Garmin: {a['activityName']}"

        print(f"  {entry['date']} {entry['distanceKm']}km {entry['time']} -> 배치에 포함")
        entries.append(entry)

    return entries


def find_vo2max(api: Garmin, lookback_days: int = 14) -> dict | None:
    # 가민이 매일 VO2max를 새로 계산해주는 건 아니라서(양질의 러닝을 해야 갱신됨),
    # 오늘 값이 비어 있으면 최근 며칠을 거슬러 올라가며 가장 최근에 갱신된 값을 찾는다.
    for days_ago in range(lookback_days):
        day = (today_kst() - timedelta(days=days_ago)).isoformat()
        try:
            raw = api.get_max_metrics(day)
        except Exception as e:  # noqa: BLE001 - 이 API는 계정/기기에 따라 자주 예외를 던진다
            print(f"VO2max 조회 실패({day}): {e}", file=sys.stderr)
            continue

        value = deep_find_number(raw, lambda k: "vo2max" in k.lower() and "value" in k.lower())
        if not value:
            value = deep_find_number(raw, lambda k: k.lower() == "vo2max")
        if not value:
            continue

        print(f"VO2max {value} ({day}) -> 배치에 포함")
        return {"date": day, "vo2max": round(float(value), 1)}

    print(f"최근 {lookback_days}일 안에서 VO2max 값을 찾지 못했습니다 (건너뜀).")
    return None


def main() -> None:
    setup_corporate_ca()
    base_url = os.environ["PACELAB_URL"].rstrip("/")
    pin = os.environ["ADMIN_PIN"]
    days_back = int(os.environ.get("SYNC_DAYS_BACK", "3"))

    api = login()

    try:
        existing = requests.get(f"{base_url}/api/data", timeout=20).json()
        race_dates = {r["date"] for r in existing.get("races", [])}
    except Exception as e:  # noqa: BLE001 - 조회 실패해도 동기화 자체는 계속 진행
        print(f"기존 대회 기록 조회 실패(레이스데이 중복 방지 건너뜀): {e}", file=sys.stderr)
        race_dates = set()

    entries = collect_activities(api, race_dates, days_back)
    vo2max = find_vo2max(api)

    if not entries and not vo2max:
        print("새로 보낼 내용이 없어 저장 요청을 건너뜁니다.")
        return

    payload = {"pin": pin, "type": "batch", "entries": entries}
    if vo2max:
        payload["vo2max"] = vo2max

    r = requests.post(f"{base_url}/api/data", json=payload, timeout=30)
    if r.ok:
        print(f"배치 저장 완료: 훈련 {len(entries)}건" + (", VO2max 포함" if vo2max else ""))
    else:
        print(f"배치 저장 실패({r.status_code}): {r.text[:300]}", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
