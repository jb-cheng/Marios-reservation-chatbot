import type { AvatarState } from "./index.tsx";

export type HostPose = {
  mouth: number;
  blink: number;
  yaw: number;
  pitch: number;
  roll: number;
  brow: number;
};

export function mouthOpening(state: AvatarState, level: number): number {
  if (state !== "speaking" || !Number.isFinite(level) || level <= 0.002) return 0;
  return Math.min(1, Math.pow((Math.min(1, level) - 0.002) * 3.2, 0.7));
}

export function samplePose(state: AvatarState, level: number, seconds: number, reducedMotion: boolean): HostPose {
  const time = reducedMotion ? 0 : seconds;
  const blinkPhase = ((time + 1.1) % 5.3) / 0.18;
  return {
    mouth: mouthOpening(state, level),
    blink: reducedMotion || blinkPhase > 2 ? 0 : Math.sin(blinkPhase * Math.PI / 2) ** 2,
    yaw: Math.sin(time * 0.63) * 0.025,
    pitch: Math.sin(time * 0.81) * 0.014,
    roll: Math.sin(time * 0.47) * 0.012,
    brow: state === "listening" ? 0.035 : state === "thinking" ? 0.018 : state === "error" ? -0.018 : 0,
  };
}
