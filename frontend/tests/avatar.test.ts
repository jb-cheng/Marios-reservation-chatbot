import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createServer } from "vite";
import type { ViteDevServer } from "vite";
import type { Mesh } from "three";

const root = fileURLToPath(new URL("../", import.meta.url));
let vite: ViteDevServer;
before(async () => {
  vite = await createServer({ root, logLevel: "silent", server: { middlewareMode: true, hmr: false, watch: null } });
});
after(async () => { await vite?.close(); });

async function motion() {
  return vite.ssrLoadModule("/src/components/Avatar/motion.ts") as Promise<typeof import("../src/components/Avatar/motion.ts")>;
}
async function host() {
  return vite.ssrLoadModule("/src/components/Avatar/rig.ts") as Promise<typeof import("../src/components/Avatar/rig.ts")>;
}

test("fallback retains the portrait, accessible image label and a mouth at its original smile", async () => {
  const { Avatar } = await vite.ssrLoadModule("/src/components/Avatar/index.tsx");
  const markup = renderToStaticMarkup(createElement(Avatar, { state: "speaking", level: 0.3, className: "host-avatar" }));
  assert.match(markup, /role="img"/);
  assert.match(markup, /aria-label="[^"]*host[^"]*"/);
  assert.match(markup, /host-portrait\.svg/);
  assert.match(markup, /<canvas[^>]*aria-hidden="true"/);
  assert.match(markup, /viewBox="0 0 236 276"/);
  assert.match(markup, /data-mouth="[^"]+"/);
  assert.doesNotMatch(markup, /aria-live|animate-candle/);
});

test("the SVG fallback seals without audio and its lip outline bounds its open cavity", async () => {
  const { Avatar } = await vite.ssrLoadModule("/src/components/Avatar/index.tsx");
  for (const state of ["idle", "listening", "thinking", "error", "speaking"] as const) {
    const markup = renderToStaticMarkup(createElement(Avatar, { state, level: state === "speaking" ? 0 : 1 }));
    assert.match(markup, /data-mouth="0"/);
    assert.doesNotMatch(markup, /fill="#512c27"/);
  }
  const open = renderToStaticMarkup(createElement(Avatar, { state: "speaking", level: 0.3 }));
  const cavity = open.match(/<path d="([^"]+)" fill="#512c27"/);
  const outline = open.match(/<path d="([^"]+)" fill="none" stroke="#97573F"/);
  assert.ok(cavity && outline);
  assert.equal(outline[1], cavity[1], "the lower lip must not cross the middle of the open mouth");
});

test("speech RMS opens the mouth monotonically, with bounded gain for quiet speech", async () => {
  const { mouthOpening } = await motion();
  const openings = [0, 0.01, 0.04, 0.12, 0.3, 1].map(level => mouthOpening("speaking", level));
  assert.equal(openings[0], 0);
  assert.ok(openings[2] > 0.15, "ordinary RMS must remain readable at the compact host size");
  for (let i = 1; i < openings.length; i++) {
    assert.ok(openings[i] >= openings[i - 1]);
    assert.ok(openings[i] <= 1);
  }
  assert.equal(mouthOpening("speaking", 100), 1);
  for (const level of [-1, NaN, Infinity, -Infinity]) assert.equal(mouthOpening("speaking", level), 0);
});

test("silence and every non-speaking state close the mouth regardless of time or stale level", async () => {
  const { samplePose } = await motion();
  for (const seconds of [0, 1, 4.2, 17, 120]) {
    assert.equal(samplePose("speaking", 0, seconds, false).mouth, 0);
    for (const state of ["idle", "listening", "thinking", "error"] as const) {
      assert.equal(samplePose(state, 1, seconds, false).mouth, 0);
    }
  }
});

test("reduced motion removes head movement and blinking but preserves audio articulation", async () => {
  const { samplePose } = await motion();
  const still = samplePose("speaking", 0.12, 0, true);
  assert.ok(still.mouth > 0);
  assert.equal(still.blink, 0);
  for (const seconds of [1, 4.2, 17, 120]) assert.deepEqual(samplePose("speaking", 0.12, seconds, true), still);
  const poses = Array.from({ length: 121 }, (_, n) => samplePose("idle", 0, n / 20, false));
  assert.ok(poses.some(pose => pose.blink > 0.7), "a natural blink occurs");
  assert.ok(poses.some(pose => pose.yaw !== poses[0].yaw), "the head is subtly alive");
  for (const pose of poses) {
    assert.ok(Math.abs(pose.yaw) < 0.05);
    assert.ok(Math.abs(pose.roll) < 0.04);
    assert.equal(pose.mouth, 0);
  }
});

test("the actual 3D face deforms, exposes a cavity and teeth, then seals immediately", async () => {
  const { createHostRig } = await host();
  const { samplePose } = await motion();
  const rig = createHostRig();
  try {
    rig.update(samplePose("idle", 0, 0, true));
    const face = rig.root.getObjectByName("face") as Mesh;
    const lips = rig.root.getObjectByName("lips") as Mesh;
    const cavity = rig.root.getObjectByName("mouth-cavity") as Mesh;
    const teeth = rig.root.getObjectByName("upper-teeth") as Mesh;
    assert.ok(face?.isMesh && lips?.isMesh && cavity?.isMesh && teeth?.isMesh);
    const closedFace = Array.from(face.geometry.getAttribute("position").array);
    const closedLips = Array.from(lips.geometry.getAttribute("position").array);
    assert.equal(cavity.visible, false);
    assert.equal(teeth.visible, false);
    rig.update(samplePose("speaking", 0.2, 0, true));
    assert.equal(cavity.visible, true);
    assert.equal(teeth.visible, true);
    assert.notDeepEqual(Array.from(face.geometry.getAttribute("position").array), closedFace);
    assert.notDeepEqual(Array.from(lips.geometry.getAttribute("position").array), closedLips);
    rig.update(samplePose("speaking", 0, 99, true));
    assert.equal(cavity.visible, false);
    assert.equal(teeth.visible, false);
    assert.deepEqual(Array.from(face.geometry.getAttribute("position").array), closedFace);
    assert.deepEqual(Array.from(lips.geometry.getAttribute("position").array), closedLips);
    rig.update(samplePose("speaking", 0.2, 0, true));
    rig.update(samplePose("listening", 1, 0, true));
    assert.equal(cavity.visible, false);
  } finally { rig.dispose(); }
});

test("the visible lip surface faces outward rather than being back-face culled", async () => {
  const { createHostRig } = await host();
  const { samplePose } = await motion();
  const rig = createHostRig();
  try {
    rig.update(samplePose("speaking", 0.2, 0, true));
    const lips = rig.root.getObjectByName("lips") as Mesh;
    const position = lips.geometry.getAttribute("position");
    const normal = lips.geometry.getAttribute("normal");
    let frontmost = 0;
    for (let i = 1; i < position.count; i++) {
      if (position.getZ(i) > position.getZ(frontmost)) frontmost = i;
    }
    assert.ok(normal.getZ(frontmost) > 0.5, "the frontmost lip must face the frontal camera");
  } finally { rig.dispose(); }
});

test("rig updates reuse geometry and disposal releases each owned GPU resource once", async () => {
  const { createHostRig } = await host();
  const { samplePose } = await motion();
  const rig = createHostRig();
  const geometries = new Set<Mesh["geometry"]>();
  const materials = new Set<Exclude<Mesh["material"], unknown[]>>();
  rig.root.traverse(object => {
    const mesh = object as Mesh;
    if (!mesh.isMesh) return;
    geometries.add(mesh.geometry);
    for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) materials.add(material);
  });
  for (let n = 0; n < 30; n++) rig.update(samplePose("speaking", n / 100, n / 60, false));
  rig.root.traverse(object => {
    const mesh = object as Mesh;
    if (mesh.isMesh) assert.ok(geometries.has(mesh.geometry), "no geometry allocations during speech");
  });
  const counts = new Map<object, number>();
  for (const resource of [...geometries, ...materials]) {
    counts.set(resource, 0);
    resource.addEventListener("dispose", () => counts.set(resource, counts.get(resource)! + 1));
  }
  rig.dispose();
  rig.dispose();
  assert.ok(counts.size > 5);
  for (const count of counts.values()) assert.equal(count, 1);
});
