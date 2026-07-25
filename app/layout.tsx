import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "PaceLab — 마라톤 훈련 AI 분석",
  description: "공식 대회 기록과 인바디 데이터를 조합해 PB와 구간 기록을 예측하는 개인 훈련 분석 랩.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  );
}
