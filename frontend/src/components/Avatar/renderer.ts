import { AmbientLight, DirectionalLight, HemisphereLight, PerspectiveCamera, Scene, SRGBColorSpace, WebGLRenderer } from "three";
import type { AvatarState } from "./index.tsx";
import { createHostRig } from "./rig.ts";
import { samplePose } from "./motion.ts";

export type AvatarRenderer = {
  update(state: AvatarState, level: number): void;
  dispose(): void;
};

export function createAvatarRenderer(canvas: HTMLCanvasElement, onUnavailable: () => void): AvatarRenderer {
  const renderer = new WebGLRenderer({ canvas, alpha: true, antialias: true, powerPreference: "low-power" });
  renderer.outputColorSpace = SRGBColorSpace;
  renderer.setClearColor(0x000000, 0);
  const scene = new Scene();
  const camera = new PerspectiveCamera(31, 236 / 276, 0.1, 30);
  camera.position.set(0, 0.22, 8.35);
  camera.lookAt(0, 0.07, 0);
  const rig = createHostRig();
  scene.add(rig.root);
  scene.add(new HemisphereLight(0xfff7e9, 0x665d4c, 2.1));
  scene.add(new AmbientLight(0xffeddb, 0.35));
  const key = new DirectionalLight(0xfff2dd, 2.5);
  key.position.set(-3, 4, 5);
  scene.add(key);
  const rim = new DirectionalLight(0xf8dda0, 1.7);
  rim.position.set(3, 2, -1);
  scene.add(rim);
  const preference = window.matchMedia("(prefers-reduced-motion: reduce)");
  let state: AvatarState = "idle";
  let level = 0;
  let frame = 0;
  let disposed = false;
  let sized = false;
  const started = performance.now();
  let observer: ResizeObserver | undefined;

  function dispose() {
    if (disposed) return;
    disposed = true;
    cancelAnimationFrame(frame);
    observer?.disconnect();
    preference.removeEventListener("change", refresh);
    document.removeEventListener("visibilitychange", refresh);
    canvas.removeEventListener("webglcontextlost", contextLost);
    rig.dispose();
    scene.clear();
    renderer.dispose();
    if (!renderer.getContext().isContextLost()) renderer.forceContextLoss();
  }
  function unavailable() {
    dispose();
    onUnavailable();
  }
  function contextLost(event: Event) {
    event.preventDefault();
    unavailable();
  }
  function draw() {
    if (disposed || !sized || document.hidden) return;
    try {
      rig.update(samplePose(state, level, (performance.now() - started) / 1000, preference.matches));
      renderer.render(scene, camera);
    } catch {
      unavailable();
    }
  }
  function tick() {
    frame = 0;
    draw();
    if (!disposed && !preference.matches && !document.hidden) frame = requestAnimationFrame(tick);
  }
  function refresh() {
    cancelAnimationFrame(frame);
    frame = 0;
    draw();
    if (!disposed && !preference.matches && !document.hidden) frame = requestAnimationFrame(tick);
  }
  function resize() {
    if (disposed) return;
    const { width, height } = canvas.getBoundingClientRect();
    sized = width > 0 && height > 0;
    if (!sized) return;
    try {
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      refresh();
    } catch {
      unavailable();
    }
  }

  try {
    canvas.addEventListener("webglcontextlost", contextLost);
    preference.addEventListener("change", refresh);
    document.addEventListener("visibilitychange", refresh);
    observer = new ResizeObserver(resize);
    observer.observe(canvas);
    resize();
  } catch (error) {
    dispose();
    throw error;
  }
  return {
    update(nextState, nextLevel) {
      state = nextState;
      level = nextLevel;
      draw();
    },
    dispose,
  };
}
