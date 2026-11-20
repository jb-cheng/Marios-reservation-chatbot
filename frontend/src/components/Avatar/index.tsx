import { useEffect, useRef, useState } from "react";
import portrait from "@/assets/host/host-portrait.svg";
import { cn } from "@/lib/utils";
import { mouthOpening } from "./motion.ts";
import type { AvatarRenderer } from "./renderer.ts";

export type AvatarState = "idle" | "listening" | "thinking" | "speaking" | "error";

type AvatarProps = {
  state: AvatarState;
  level?: number;
  className?: string;
};

export function Avatar({ state, level = 0, className }: AvatarProps) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const renderer = useRef<AvatarRenderer | null>(null);
  const current = useRef({ state, level });
  const [ready, setReady] = useState(false);
  const opening = mouthOpening(state, level);
  const mouthPath = opening > 0
    ? `M107 106 Q119 ${108 - opening * 3} 131 104 Q127 ${109 + opening * 10} 118 ${109 + opening * 9} Q111 ${109 + opening * 6} 107 106Z`
    : "M107 106 Q119 109 131 104";

  useEffect(() => {
    current.current = { state, level };
    renderer.current?.update(state, level);
  }, [state, level]);

  useEffect(() => {
    let cancelled = false;
    let failed = false;
    let mounted: AvatarRenderer | null = null;
    // Marketing entries share the component graph, but never mount this renderer.
    void import("./renderer.ts").then(({ createAvatarRenderer }) => {
      if (cancelled || !canvas.current) return;
      mounted = createAvatarRenderer(canvas.current, () => {
        failed = true;
        if (!cancelled) setReady(false);
      });
      if (failed) return;
      renderer.current = mounted;
      mounted.update(current.current.state, current.current.level);
      if (!failed) setReady(true);
    }).catch(() => {
      mounted?.dispose();
      if (!cancelled) setReady(false);
    });
    return () => {
      cancelled = true;
      renderer.current = null;
      mounted?.dispose();
    };
  }, []);

  return (
    <div
      role="img"
      aria-label="Mario's virtual host in a cream dinner jacket and bow tie, with a mouth that follows the speech"
      className={cn("relative w-[236px] max-w-full select-none", className)}
      style={{ aspectRatio: "236 / 276" }}
    >
      <div aria-hidden="true" className="absolute inset-0" style={{ visibility: ready ? "hidden" : "visible" }}>
        <img src={portrait} alt="" width={236} height={276} draggable={false} className="block h-auto w-full" />
        <svg aria-hidden="true" viewBox="0 0 236 276" className="pointer-events-none absolute inset-0 h-full w-full">
          <g data-mouth={opening}>
            <path d="M105 103 Q118 102 132 102 L132 116 Q118 119 105 112Z" fill="#CB8969" />
            {opening > 0 && <path d={mouthPath} fill="#512c27" />}
            {opening > 0.035 && <path
              d={`M109 106.4 Q119 ${107.8 - opening * 3} 129 104.8 Q125 ${108 + opening} 118 ${108.4 + opening} Q113 108.8 109 106.4Z`}
              fill="#F4EFE5"
            />}
            <path
              d={mouthPath}
              fill="none" stroke="#97573F" strokeWidth="0.85" strokeLinecap="round"
            />
          </g>
        </svg>
      </div>
      <canvas ref={canvas} aria-hidden="true" width={236} height={276} className="pointer-events-none absolute inset-0 block h-full w-full" style={{ visibility: ready ? "visible" : "hidden" }} />
    </div>
  );
}
