"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export interface DockApp {
  id: string;
  name: string;
  icon: string;
  command: string;
}

interface MacOSDockProps {
  apps: DockApp[];
  onAppClick: (appId: string) => void;
  className?: string;
}

function cn(...classes: (string | undefined | false | null)[]) {
  return classes.filter(Boolean).join(" ");
}

export function MacOSDock({ apps, onAppClick, className = "" }: MacOSDockProps) {
  const [mouseX, setMouseX] = useState<number | null>(null);
  const [currentScales, setCurrentScales] = useState<number[]>(apps.map(() => 1));
  const [currentPositions, setCurrentPositions] = useState<number[]>([]);
  const dockRef = useRef<HTMLDivElement>(null);
  const iconRefs = useRef<(HTMLDivElement | null)[]>([]);
  const animationFrameRef = useRef<number | undefined>(undefined);
  const lastMouseMoveTime = useRef<number>(0);

  const getConfig = useCallback(() => {
    const w = typeof window !== "undefined" ? Math.min(window.innerWidth, window.innerHeight) : 1024;
    if (w < 480) return { baseIconSize: 40, maxScale: 1.4, effectWidth: w * 0.4 };
    if (w < 768) return { baseIconSize: 48, maxScale: 1.5, effectWidth: w * 0.35 };
    if (w < 1024) return { baseIconSize: 56, maxScale: 1.6, effectWidth: w * 0.3 };
    return { baseIconSize: 64, maxScale: 1.8, effectWidth: 300 };
  }, []);

  const [cfg, setCfg] = useState(getConfig);
  const { baseIconSize, maxScale, effectWidth } = cfg;
  const minScale = 1;
  const gap = Math.max(4, baseIconSize * 0.08);

  useEffect(() => {
    const onResize = () => setCfg(getConfig());
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [getConfig]);

  const calcTarget = useCallback(
    (mx: number | null) => {
      if (mx === null) return apps.map(() => minScale);
      const half = effectWidth / 2;
      return apps.map((_, i) => {
        const cx = i * (baseIconSize + gap) + baseIconSize / 2;
        if (cx < mx - half || cx > mx + half) return minScale;
        const t = ((cx - (mx - half)) / effectWidth) * Math.PI * 2;
        const f = (1 - Math.cos(Math.max(0, Math.min(t, Math.PI * 2)))) / 2;
        return minScale + f * (maxScale - minScale);
      });
    },
    [apps.length, baseIconSize, gap, effectWidth, maxScale, minScale],
  );

  const calcPos = useCallback(
    (scales: number[]) => {
      let x = 0;
      return scales.map((s) => {
        const w = baseIconSize * s;
        const c = x + w / 2;
        x += w + gap;
        return c;
      });
    },
    [baseIconSize, gap],
  );

  useEffect(() => {
    const s = apps.map(() => minScale);
    setCurrentScales(s);
    setCurrentPositions(calcPos(s));
  }, [apps.length, calcPos, minScale]);

  const tick = useCallback(() => {
    const target = calcTarget(mouseX);
    const tpos = calcPos(target);
    const lerp = mouseX !== null ? 0.2 : 0.12;

    setCurrentScales((prev) => prev.map((v, i) => v + (target[i] - v) * lerp));
    setCurrentPositions((prev) => prev.map((v, i) => v + (tpos[i] - v) * lerp));

    const need =
      mouseX !== null ||
      currentScales.some((v, i) => Math.abs(v - target[i]) > 0.002) ||
      currentPositions.some((v, i) => Math.abs(v - tpos[i]) > 0.1);

    if (need) {
      animationFrameRef.current = requestAnimationFrame(tick);
    }
  }, [mouseX, calcTarget, calcPos, currentScales, currentPositions]);

  useEffect(() => {
    cancelAnimationFrame(animationFrameRef.current!);
    animationFrameRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(animationFrameRef.current!);
  }, [tick]);

  const onMouseMove = useCallback(
    (e: React.MouseEvent) => {
      const now = performance.now();
      if (now - lastMouseMoveTime.current < 16) return;
      lastMouseMoveTime.current = now;
      if (dockRef.current) {
        const r = dockRef.current.getBoundingClientRect();
        setMouseX(e.clientX - r.left - Math.max(8, baseIconSize * 0.12));
      }
    },
    [baseIconSize],
  );

  const onMouseLeave = useCallback(() => setMouseX(null), []);

  const contentWidth =
    currentPositions.length > 0
      ? Math.max(...currentPositions.map((p, i) => p + (baseIconSize * currentScales[i]) / 2))
      : apps.length * (baseIconSize + gap) - gap;

  const pad = Math.max(8, baseIconSize * 0.12);

  const handleClick = (id: string, idx: number) => {
    const el = iconRefs.current[idx];
    if (el) {
      el.style.transition = "transform 0.2s ease-out";
      el.style.transform = `translateY(${Math.max(-8, -(baseIconSize * 0.15))}px)`;
      setTimeout(() => { el.style.transform = "translateY(0)"; }, 200);
    }
    onAppClick(id);
  };

  return (
    <div
      ref={dockRef}
      className={cn("dock", className)}
      onMouseMove={onMouseMove}
      onMouseLeave={onMouseLeave}
      style={{
        width: `${contentWidth + pad * 2}px`,
        borderRadius: `${Math.max(12, baseIconSize * 0.4)}px`,
      }}
    >
      <div
        className="dockStage"
        style={{ height: `${baseIconSize}px`, width: "100%" }}
      >
        {apps.map((app, i) => {
          const scale = currentScales[i] || 1;
          const pos = currentPositions[i] || 0;
          const sz = baseIconSize * scale;

          return (
            <div
              key={app.id}
              ref={(el) => { iconRefs.current[i] = el; }}
              className="dockApp"
              onClick={() => handleClick(app.id, i)}
              title={app.name}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  handleClick(app.id, i);
                }
              }}
              style={{
                left: `${pos - sz / 2}px`,
                width: `${sz}px`,
                height: `${sz}px`,
                zIndex: Math.round(scale * 10),
              }}
            >
              <img
                src={app.icon}
                alt={app.name}
                width={sz}
                height={sz}
                className="dockAppIcon"
                style={{
                  filter: `drop-shadow(0 ${scale > 1.2 ? 2 : 1}px ${scale > 1.2 ? 4 : 2}px rgba(0,0,0,${0.2 + (scale - 1) * 0.15}))`,
                }}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}
