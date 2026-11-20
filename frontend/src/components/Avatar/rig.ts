import {
  BufferGeometry, CatmullRomCurve3, CircleGeometry, DoubleSide, ExtrudeGeometry,
  Float32BufferAttribute, Group, Mesh, MeshStandardMaterial, Shape,
  SphereGeometry, TubeGeometry, Vector3,
} from "three";
import type { HostPose } from "./motion.ts";

const TAU = Math.PI * 2;
const SEGMENTS = 80;
const FACE_RINGS = 28;
type Point = [number, number, number];

function surface(x: number, y: number): number {
  const dome = Math.sqrt(Math.max(0, 1 - (x / 0.72) ** 2 - ((y - 0.12) / 1.03) ** 2));
  const bump = (cx: number, cy: number, sx: number, sy: number) => Math.exp(-(((x - cx) / sx) ** 2) - ((y - cy) / sy) ** 2);
  return 0.09 + dome * 0.47
    + 0.055 * (bump(-0.36, -0.04, 0.2, 0.23) + bump(0.36, -0.04, 0.2, 0.23))
    + 0.14 * bump(0, 0.22, 0.105, 0.3) + 0.24 * bump(0, -0.015, 0.13, 0.125)
    + 0.035 * bump(0, -0.55, 0.32, 0.18);
}

function mouthPoint(angle: number, opening: number): [number, number] {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return [c * (0.255 - opening * 0.022), -0.325 + 0.038 * c * c + s * (0.006 + opening * 0.14) - opening * 0.038];
}

function grid(columns: number, rows: number): BufferGeometry {
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new Float32BufferAttribute(new Float32Array((columns + 1) * (rows + 1) * 3), 3));
  const indices: number[] = [];
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < columns; col++) {
      const a = row * (columns + 1) + col;
      const b = a + columns + 1;
      indices.push(a, b, a + 1, b, b + 1, a + 1);
    }
  }
  geometry.setIndex(indices);
  return geometry;
}

function fill(geometry: BufferGeometry, columns: number, rows: number, point: (u: number, v: number) => Point) {
  const position = geometry.getAttribute("position");
  for (let row = 0; row <= rows; row++) {
    for (let col = 0; col <= columns; col++) position.setXYZ(row * (columns + 1) + col, ...point(col / columns, row / rows));
  }
  position.needsUpdate = true;
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
}

export function createHostRig() {
  const root = new Group();
  const head = new Group();
  head.position.y = 0.98;
  head.scale.setScalar(0.95);
  root.add(head);
  const geometries = new Set<BufferGeometry>();
  const materials = new Set<MeshStandardMaterial>();
  const material = (color: string, roughness = 0.72, metalness = 0) => {
    const value = new MeshStandardMaterial({ color, roughness, metalness });
    materials.add(value);
    return value;
  };
  const skin = material("#ca896c");
  const earShade = material("#aa6550");
  const lipsMaterial = material("#ab6856", 0.62);
  const hair = material("#242d28", 0.58);
  const hairLight = material("#3c4436", 0.67);
  const cream = material("#f3eedf", 0.85);
  const lapel = material("#fffaed", 0.7);
  const seam = material("#c9bda3");
  const black = material("#202822", 0.79);
  const gold = material("#b99a61", 0.64, 0.25);
  const eyeWhite = material("#fff8e7", 0.38);
  const iris = material("#634b31", 0.48);
  const pupil = material("#18241e", 0.32);
  const highlight = material("#ffffff", 0.15);

  function mesh(name: string, geometry: BufferGeometry, appearance: MeshStandardMaterial, parent = head) {
    geometries.add(geometry);
    const object = new Mesh(geometry, appearance);
    object.name = name;
    parent.add(object);
    return object;
  }
  function ellipsoid(name: string, center: Point, scale: Point, appearance: MeshStandardMaterial, parent = head) {
    const object = mesh(name, new SphereGeometry(1, 40, 28), appearance, parent);
    object.position.set(...center);
    object.scale.set(...scale);
    return object;
  }
  function stroke(name: string, points: Point[], radius: number, appearance: MeshStandardMaterial, parent = head) {
    return mesh(name, new TubeGeometry(new CatmullRomCurve3(points.map(point => new Vector3(...point))), 36, radius, 8, false), appearance, parent);
  }
  function tailoring(name: string, points: [number, number][], z: number, appearance: MeshStandardMaterial) {
    const shape = new Shape();
    shape.moveTo(...points[0]);
    for (const point of points.slice(1)) shape.lineTo(...point);
    shape.closePath();
    const object = mesh(name, new ExtrudeGeometry(shape, { depth: 0.035, bevelEnabled: true, bevelSegments: 3, steps: 1, bevelSize: 0.025, bevelThickness: 0.025 }), appearance, root);
    object.position.z = z;
    return object;
  }

  const backdrop = mesh("gold-oval", new CircleGeometry(1, 100), gold, root);
  backdrop.position.set(0, 0.05, -0.55);
  backdrop.scale.set(1.51, 1.98, 1);
  stroke("oval-inlay", Array.from({ length: 81 }, (_, i) => [Math.cos(i / 80 * TAU) * 1.43, 0.05 + Math.sin(i / 80 * TAU) * 1.89, -0.53]), 0.006, seam, root);

  // The jacket is a continuous tailored volume rather than separate shoulder balls.
  const jacket = grid(80, 28);
  fill(jacket, 80, 28, (u, v) => {
    const angle = u * TAU;
    const width = 0.32 + 1.13 * Math.sin(Math.min(1, v * 2.7) * Math.PI / 2);
    const y = -0.08 - v * 1.84 + 0.07 * Math.cos(angle) ** 2 * (1 - v);
    return [Math.cos(angle) * width, y, Math.sin(angle) * (0.28 + v * 0.16) - 0.07];
  });
  jacket.setIndex(Array.from(jacket.getIndex()!.array).reverse());
  jacket.computeVertexNormals();
  mesh("dinner-jacket", jacket, cream, root);
  ellipsoid("neck", [0, -0.05, -0.005], [0.31, 0.54, 0.28], skin, root);
  tailoring("shirt", [[-0.31, -0.03], [0, -0.19], [0.31, -0.03], [0.38, -0.57], [0, -1.3], [-0.38, -0.57]], 0.35, lapel);
  tailoring("left-lapel", [[-0.34, 0.03], [-0.66, -0.14], [-0.83, -0.58], [-0.59, -0.64], [-0.72, -0.82], [-0.06, -1.5]], 0.43, lapel);
  tailoring("right-lapel", [[0.34, 0.03], [0.66, -0.14], [0.83, -0.58], [0.59, -0.64], [0.72, -0.82], [0.06, -1.5]], 0.43, lapel);
  stroke("left-lapel-stitch", [[-0.37, -0.05, 0.505], [-0.56, -0.66, 0.505], [-0.075, -1.45, 0.505]], 0.007, seam, root);
  stroke("right-lapel-stitch", [[0.37, -0.05, 0.505], [0.56, -0.66, 0.505], [0.075, -1.45, 0.505]], 0.007, seam, root);
  tailoring("left-collar", [[-0.29, 0.06], [0, -0.13], [-0.19, -0.37], [-0.39, -0.13]], 0.5, lapel);
  tailoring("right-collar", [[0.29, 0.06], [0, -0.13], [0.19, -0.37], [0.39, -0.13]], 0.5, lapel);
  tailoring("bow-left", [[-0.04, -0.17], [-0.3, -0.085], [-0.32, -0.34], [-0.055, -0.27]], 0.61, black);
  tailoring("bow-right", [[0.04, -0.17], [0.3, -0.085], [0.32, -0.34], [0.055, -0.27]], 0.61, black);
  ellipsoid("bow-knot", [0, -0.215, 0.685], [0.087, 0.1, 0.055], black, root);
  ellipsoid("jacket-button", [0, -1.56, 0.44], [0.045, 0.045, 0.024], gold, root);
  tailoring("pocket-welt", [[0.87, -0.8], [1.17, -0.75], [1.17, -0.81], [0.87, -0.86]], 0.34, seam);
  tailoring("pocket-square", [[0.9, -0.79], [0.92, -0.63], [1.03, -0.72], [1.12, -0.61], [1.15, -0.75]], 0.32, lapel);

  const back = grid(SEGMENTS, 20);
  fill(back, SEGMENTS, 20, (u, v) => {
    const theta = u * TAU;
    const y = 0.12 + 0.98 * Math.sin(theta) * v;
    const taper = 1 - 0.16 * Math.max(0, -Math.sin(theta));
    return [0.69 * Math.cos(theta) * v * taper, y, 0.09 - 0.53 * Math.sqrt(1 - v * v)];
  });
  skin.side = DoubleSide;
  mesh("back-of-head", back, skin);
  for (const side of [-1, 1]) {
    ellipsoid("ear", [side * 0.663, 0.05, 0.06], [0.14, 0.235, 0.115], skin);
    ellipsoid("ear-fold", [side * 0.715, 0.055, 0.155], [0.049, 0.13, 0.026], earShade);
    stroke("ear-ridge", [[side * 0.7, 0.145, 0.17], [side * 0.735, 0.09, 0.18], [side * 0.71, -0.025, 0.17]], 0.018, skin);
  }
  const face = mesh("face", grid(SEGMENTS, FACE_RINGS), skin);
  const lips = mesh("lips", grid(SEGMENTS, 10), lipsMaterial);
  lips.geometry.setIndex(Array.from(lips.geometry.getIndex()!.array).reverse());
  const cavityMaterial = material("#421f1c", 1);
  cavityMaterial.side = DoubleSide;
  const cavity = mesh("mouth-cavity", grid(SEGMENTS, 10), cavityMaterial);
  const teeth = mesh("upper-teeth", grid(36, 4), eyeWhite);
  eyeWhite.side = DoubleSide;

  const eyes: Group[] = [];
  const brows: Mesh[] = [];
  for (const side of [-1, 1]) {
    const x = side * 0.275;
    const y = 0.285;
    const z = surface(x, y);
    const eye = new Group();
    eye.name = "eye";
    eye.position.set(x, y, z + 0.025);
    head.add(eye);
    eyes.push(eye);
    ellipsoid("eye-socket", [0, 0, -0.031], [0.185, 0.11, 0.04], earShade, eye);
    ellipsoid("eye-white", [0, 0, 0], [0.174, 0.086, 0.04], eyeWhite, eye);
    ellipsoid("iris", [-side * 0.01, 0.003, 0.045], [0.065, 0.071, 0.023], iris, eye);
    ellipsoid("pupil", [-side * 0.01, 0.004, 0.066], [0.034, 0.048, 0.01], pupil, eye);
    ellipsoid("catchlight", [-0.024, 0.029, 0.077], [0.015, 0.017, 0.006], highlight, eye);
    stroke("upper-eyelid", [[-0.174, 0, 0.002], [-0.08, 0.087, 0.019], [0.05, 0.084, 0.019], [0.174, 0.004, 0.002]], 0.012, hair, eye);
    stroke("lower-eyelid", [[-0.17, 0, 0], [0, -0.084, 0.01], [0.17, 0, 0]], 0.017, skin, eye);
    brows.push(stroke("brow", [[x - 0.18, 0.472, surface(x - 0.18, 0.472) + 0.025], [x - 0.07, 0.514, surface(x - 0.07, 0.514) + 0.035], [x + 0.07, 0.509, surface(x + 0.07, 0.509) + 0.035], [x + 0.17, 0.469, surface(x + 0.17, 0.469) + 0.025]], 0.034, hair));
    ellipsoid("nostril", [side * 0.087, -0.082, surface(side * 0.087, -0.082) + 0.002], [0.032, 0.015, 0.009], earShade);
  }

  // A single swept cap follows the skull, with fine raised comb lines instead of hair clumps.
  const hairCap = grid(80, 28);
  function hairPoint(u: number, v: number): Point {
    const theta = u * TAU;
    const front = Math.max(0, Math.sin(theta));
    const sweep = 0.12 * Math.cos(theta) * front;
    const edge = 1.85 - front * (0.68 + sweep);
    const phi = 0.015 + v * edge;
    return [Math.cos(theta) * Math.sin(phi) * 0.73 - (1 - v) * 0.15, 0.38 + Math.cos(phi) * 0.85 + front * Math.sin(phi) * 0.09 + Math.cos(theta) * Math.sin(phi) * 0.05, Math.sin(theta) * Math.sin(phi) * 0.585 + 0.02];
  }
  fill(hairCap, 80, 28, hairPoint);
  hair.side = DoubleSide;
  mesh("swept-hair", hairCap, hair);
  for (let i = 0; i < 9; i++) {
    const points: Point[] = [];
    for (let j = 0; j < 24; j++) {
      const v = 0.22 + j / 23 * 0.73;
      const u = 0.025 + i * 0.051 + (1 - v) * 0.11;
      const [x, y, z] = hairPoint(u, v);
      points.push([x, y + 0.008, z + 0.009]);
    }
    stroke("combed-strand", points, 0.007, hairLight);
  }

  let lastMouth = -1;
  let disposed = false;
  function update(pose: HostPose) {
    if (disposed) return;
    head.rotation.set(pose.pitch, pose.yaw, pose.roll);
    for (const eye of eyes) eye.scale.y = Math.max(0.06, 1 - pose.blink);
    brows.forEach((brow, index) => { brow.position.y = pose.brow * (index === 0 ? 1 : 0.6); });
    if (pose.mouth === lastMouth) return;
    const opening = pose.mouth;
    lastMouth = opening;
    cavity.visible = opening > 0;
    teeth.visible = opening > 0.035;
    fill(face.geometry, SEGMENTS, FACE_RINGS, (u, v) => {
      const theta = u * TAU;
      const [mx, my] = mouthPoint(theta, opening);
      const s = Math.sin(theta);
      const outerX = 0.69 * Math.cos(theta) * (1 - 0.16 * Math.max(0, -s));
      const outerY = 0.12 + 0.98 * s - opening * 0.045 * Math.max(0, -s);
      const x = mx * (1 - v) + outerX * v;
      const y = my * (1 - v) + outerY * v;
      return [x, y, surface(x, y)];
    });
    fill(lips.geometry, SEGMENTS, 10, (u, v) => {
      const theta = u * TAU;
      const cross = v * TAU;
      const [x, y] = mouthPoint(theta, opening);
      const thickness = 0.012 + 0.004 * Math.max(0, -Math.sin(theta));
      return [x + Math.cos(theta) * Math.cos(cross) * thickness, y + Math.sin(theta) * Math.cos(cross) * thickness, surface(x, y) + Math.sin(cross) * thickness + 0.006];
    });
    fill(cavity.geometry, SEGMENTS, 10, (u, v) => {
      const [x, y] = mouthPoint(u * TAU, opening);
      const center = -0.325 - opening * 0.038;
      return [x * v, center + (y - center) * v, surface(x * v, center + (y - center) * v) - 0.015 - (1 - v * v) * 0.14];
    });
    fill(teeth.geometry, 36, 4, (u, v) => {
      const angle = Math.acos((u * 2 - 1) * 0.83);
      const [x, y] = mouthPoint(angle, opening);
      const height = Math.min(0.06, opening * 0.115) * Math.sin(angle);
      return [x, y - 0.009 - v * height, surface(x, y) - 0.022 + Math.sin(v * Math.PI) * 0.004];
    });
  }
  update({ mouth: 0, blink: 0, yaw: 0, pitch: 0, roll: 0, brow: 0 });
  return {
    root,
    update,
    dispose() {
      if (disposed) return;
      disposed = true;
      for (const geometry of geometries) geometry.dispose();
      for (const appearance of materials) appearance.dispose();
      root.clear();
    },
  };
}
