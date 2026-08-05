#!/usr/bin/env python3
"""가민 Connect 최초 로그인 — 반드시 로컬에서 직접 실행할 것.

이메일/비밀번호(+필요시 MFA 코드)를 입력받아 로그인하고, 세션 토큰을
~/.garminconnect 에 저장한 뒤 GitHub Actions 시크릿에 넣을 수 있도록
tar+base64로 인코딩해 파일로 출력한다.

절대 다른 사람이 이 스크립트를 대신 실행하게 하거나, 출력된 값을
공개 저장소나 채팅에 붙여넣지 말 것 — 이 값만으로 가민 계정에 로그인할 수 있다.

사용법:
    pip install -r scripts/requirements.txt
    python scripts/garmin_login.py
"""

import base64
import io
import os
import tarfile
import tempfile
from getpass import getpass
from pathlib import Path

TOKEN_DIR = Path(os.path.expanduser("~/.garminconnect"))
OUT_FILE = Path(__file__).parent / "garmin_tokens_b64.txt"
CORPORATE_CA = Path(__file__).resolve().parent.parent / "corporate-ca.pem"


def setup_corporate_ca() -> None:
    """사내망 SSL 인터셉션(자체 서명 루트 인증서) 환경이면 curl_cffi/requests가
    신뢰하도록 등록한다. corporate-ca.pem이 없으면(일반 네트워크) 아무 것도 하지 않는다."""
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

    email = input("가민 이메일: ").strip()
    password = getpass("가민 비밀번호: ")

    api = Garmin(email=email, password=password, prompt_mfa=lambda: input("MFA 코드: ").strip())
    api.login(str(TOKEN_DIR))
    print(f"로그인 성공. 토큰 저장 위치: {TOKEN_DIR}")

    buf = io.BytesIO()
    with tarfile.open(fileobj=buf, mode="w:gz") as tar:
        tar.add(TOKEN_DIR, arcname=".")
    encoded = base64.b64encode(buf.getvalue()).decode()
    OUT_FILE.write_text(encoded)

    print(f"\nGitHub 시크릿용 값을 {OUT_FILE} 에 저장했습니다.")
    print("다음 단계:")
    print("  1. GitHub 저장소 → Settings → Secrets and variables → Actions")
    print(f"  2. New repository secret → 이름 GARMIN_TOKENS_B64, 값은 {OUT_FILE.name} 파일 내용 전체")
    print("  3. 저장 후 로컬의 이 파일은 반드시 삭제하세요 (민감한 로그인 정보입니다).")


if __name__ == "__main__":
    main()
