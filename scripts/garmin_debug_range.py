#!/usr/bin/env python3
"""특정 기간의 가민 활동을 종류 필터 없이 전부 출력한다 (디버깅용, 로컬 전용).

garmin_login.py로 이미 저장된 토큰(~/.garminconnect)을 그대로 재사용하므로
다시 로그인할 필요 없다.

사용법:
    python scripts/garmin_debug_range.py 2025-11-08 2025-11-18
"""

import os
import sys
import tempfile
from pathlib import Path

TOKEN_DIR = Path(os.path.expanduser("~/.garminconnect"))
CORPORATE_CA = Path(__file__).resolve().parent.parent / "corporate-ca.pem"


def setup_corporate_ca() -> None:
    if not CORPORATE_CA.exists():
        return
    import certifi

    combined = Path(tempfile.gettempdir()) / "pacelab_combined_ca.pem"
    combined.write_bytes(Path(certifi.where()).read_bytes() + b"\n" + CORPORATE_CA.read_bytes())
    for var in ("REQUESTS_CA_BUNDLE", "CURL_CA_BUNDLE", "SSL_CERT_FILE"):
        os.environ[var] = str(combined)
    print(f"사내망 SSL 인터셉션 인증서를 신뢰 목록에 추가했습니다 ({CORPORATE_CA.name}).")


def main() -> None:
    setup_corporate_ca()
    from garminconnect import Garmin

    if len(sys.argv) != 3:
        print("사용법: python scripts/garmin_debug_range.py YYYY-MM-DD YYYY-MM-DD", file=sys.stderr)
        sys.exit(1)
    start, end = sys.argv[1], sys.argv[2]

    api = Garmin()
    api.login(str(TOKEN_DIR))

    activities = api.get_activities_by_date(start, end) or []
    print(f"{start} ~ {end}: 활동 {len(activities)}건 (종류 무관)\n")
    for a in activities:
        type_key = (a.get("activityType", {}) or {}).get("typeKey", "?")
        print(
            f"  {a.get('startTimeLocal', '?')} | {type_key:20s} | "
            f"{(a.get('distance') or 0) / 1000:.3f}km | "
            f"{a.get('duration', 0):.0f}s | {a.get('activityName', '')}"
        )


if __name__ == "__main__":
    main()
