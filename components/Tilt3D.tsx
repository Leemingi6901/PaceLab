"use client";

import { useEffect } from "react";

/**
 * 마우스를 올린 블럭이 커서 방향으로 기울어지는 3D 틸트 효과.
 *
 * 카드마다 래퍼 컴포넌트를 씌우는 대신 document에 포인터 이벤트 하나만 걸고 closest()로
 * 대상을 찾는다 — 훈련 로그처럼 페이지를 넘길 때마다 카드가 새로 그려지는 곳도 리스너를
 * 다시 붙일 필요 없이 그대로 동작하고, page.tsx의 JSX도 건드리지 않아도 되기 때문이다.
 */

/** 틸트를 적용할 블럭들 */
const SELECTOR = [
  ".pl-card",
  ".pl-stat",
  ".pl-weight-sim-cell",
  ".pl-plan-phases li",
  ".pl-cal-cell.active",
].join(", ");

/** 최대 기울기(도). 이 사이트의 차분한 톤에 맞춰 과하지 않게 */
const MAX_DEG = 7;
/** 원근 거리(px) — 작을수록 왜곡이 심해진다 */
const PERSPECTIVE = 700;
/** 기울일 때 살짝 떠오르는 높이(px) */
const LIFT_PX = 6;

const clamp = (v: number) => Math.max(-1, Math.min(1, v));

export default function Tilt3D() {
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    let active: HTMLElement | null = null;
    let frame = 0;

    const clear = () => {
      if (!active) return;
      active.classList.remove("pl-tilting");
      active.style.transform = "";
      active = null;
    };

    const apply = (el: HTMLElement, clientX: number, clientY: number) => {
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) return;
      const px = clamp((clientX - (r.left + r.width / 2)) / (r.width / 2));
      const py = clamp((clientY - (r.top + r.height / 2)) / (r.height / 2));
      // 커서가 위쪽이면 윗변이 뒤로 눕도록 rotateX 부호를 뒤집는다
      el.style.transform =
        `perspective(${PERSPECTIVE}px) ` +
        `rotateX(${(-py * MAX_DEG).toFixed(2)}deg) ` +
        `rotateY(${(px * MAX_DEG).toFixed(2)}deg) ` +
        `translateY(-${LIFT_PX}px)`;
    };

    const onMove = (e: PointerEvent) => {
      if (e.pointerType !== "mouse") return;

      const target = (e.target as Element | null)?.closest?.(SELECTOR) as HTMLElement | null;
      if (target !== active) {
        clear();
        if (target) {
          active = target;
          active.classList.add("pl-tilting");
        }
      }
      if (!active) return;

      // 카드가 방금 지워졌다면(예: 훈련 로그 페이지 넘김) 붙잡고 있지 않는다
      if (!active.isConnected) {
        active = null;
        return;
      }

      const el = active;
      const { clientX, clientY } = e;
      if (frame) cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => apply(el, clientX, clientY));
    };

    // 스크롤하면 블럭 위치가 바뀌어 기울기가 실제 커서 위치와 어긋나므로 원위치시킨다
    const onScrollOrLeave = () => {
      if (frame) cancelAnimationFrame(frame);
      frame = 0;
      clear();
    };

    document.addEventListener("pointermove", onMove, { passive: true });
    document.addEventListener("pointerleave", onScrollOrLeave);
    window.addEventListener("scroll", onScrollOrLeave, { passive: true });

    return () => {
      document.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerleave", onScrollOrLeave);
      window.removeEventListener("scroll", onScrollOrLeave);
      if (frame) cancelAnimationFrame(frame);
      clear();
    };
  }, []);

  return null;
}
