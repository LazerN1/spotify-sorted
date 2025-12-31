import { useEffect, useRef, useState } from "react";

export default function LoadingModal({
  message = "Loading...",
  progress,
  visible = true,
}: {
  message?: string;
  progress?: number;
  visible?: boolean;
}) {
  const [autoProgress, setAutoProgress] = useState(0);
  const autoTargetRef = useRef(0);
  const [shouldRender, setShouldRender] = useState(visible);
  const [isVisible, setIsVisible] = useState(visible);

  useEffect(() => {
    if (visible) {
      setShouldRender(true);
      const frame = requestAnimationFrame(() => setIsVisible(true));
      return () => cancelAnimationFrame(frame);
    }
    setIsVisible(false);
    const timer = setTimeout(() => {
      setShouldRender(false);
    }, 220);
    return () => clearTimeout(timer);
  }, [visible]);

  useEffect(() => {
    if (typeof progress === "number") return;
    let active = true;
    autoTargetRef.current = 8;
    autoValueRef.current = 0;
    setAutoProgress(0);
    const tick = setInterval(() => {
      if (!active) return;
      setAutoProgress((prev) => {
        const target = autoTargetRef.current;
        if (prev >= target) return prev;
        const delta = target - prev;
        const step = Math.max(0.6, Math.min(3, delta * 0.25));
        const next = Math.min(target, prev + step);
        return next;
      });
    }, 200);
    const nudge = setInterval(() => {
      if (!active) return;
      if (autoTargetRef.current < 95) {
        autoTargetRef.current = Math.min(95, autoTargetRef.current + 2);
      }
    }, 4000);
    return () => {
      active = false;
      clearInterval(tick);
      clearInterval(nudge);
    };
  }, [progress]);

  const value = typeof progress === "number" ? progress : autoProgress;
  const clamped = Math.min(100, Math.max(0, Math.round(value)));
  if (!shouldRender) return null;
  return (
    <div
      className={`loading-overlay ${
        isVisible ? "loading-overlay-visible" : "loading-overlay-hidden"
      }`}
      role="status"
      aria-live="polite"
    >
      <div className="loading-card loading-card-wide">
        <span className="loading-message">{message}</span>
        <div
          className="loading-bar"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={clamped ?? undefined}
          aria-valuetext={clamped !== null ? `${clamped}%` : message}
        >
          <span
            className={`loading-bar-fill ${
              clamped === null ? "loading-bar-indeterminate" : "loading-bar-determinate"
            }`}
            style={clamped === null ? undefined : { width: `${clamped}%` }}
          />
        </div>
        {clamped !== null ? (
          <span className="loading-percent">{clamped}%</span>
        ) : null}
      </div>
    </div>
  );
}
