"use client";

import { useEffect, useRef, useState } from "react";

interface Props {
  children: React.ReactNode;
  className?: string;
  /** ms 단위 지연 — 여러 개를 순서대로 살짝 어긋나게(stagger) 보이고 싶을 때 */
  delayMs?: number;
}

/** 뷰포트에 들어오면 한 번만 fade+slide-up으로 나타나는 래퍼. 뷰포트를 이미 벗어난 채로 로드돼도(새로고침 등) 바로 보이도록 처리한다 */
export default function Reveal({ children, className, delayMs = 0 }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          if (delayMs > 0) {
            setTimeout(() => setVisible(true), delayMs);
          } else {
            setVisible(true);
          }
          observer.disconnect();
        }
      },
      { threshold: 0.12, rootMargin: "0px 0px -60px 0px" }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [delayMs]);

  return (
    <div ref={ref} className={`pl-reveal ${visible ? "pl-reveal-visible" : ""} ${className ?? ""}`}>
      {children}
    </div>
  );
}
