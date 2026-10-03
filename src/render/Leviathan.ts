import * as THREE from 'three';

/**
 * "Grandmother": a whale-sized creature that swims past outside the dome by
 * the Glass. A chain of segments with a travelling body wave, pale
 * bioluminescent spots and long fins. Not affected by fog so she reads
 * through the murky water as a dim, huge shape.
 */
export class Leviathan {
  readonly root = new THREE.Group();
  private readonly segs: THREE.Mesh[] = [];
  private readonly fins: THREE.Mesh[] = [];
  private t = -1;
  private nextAuto = 40;
  private readonly from = new THREE.Vector3();
  private readonly to = new THREE.Vector3();
  private duration = 28;
  private readonly tmp = new THREE.Vector3();
  private readonly tmp2 = new THREE.Vector3();
  private readonly head = new THREE.Vector3();
  private readonly fadeMats: THREE.MeshStandardMaterial[] = [];

  constructor(scene: THREE.Scene) {
    const body = new THREE.MeshStandardMaterial({ color: 0x1a2a34, roughness: 0.6, metalness: 0.1, fog: false, transparent: true, opacity: 0.9 });
    const belly = new THREE.MeshStandardMaterial({ color: 0x3a5a66, roughness: 0.6, fog: false, transparent: true, opacity: 0.9 });
    const spots = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.4, 1.4, 1.6), fog: false });
    const n = 14;
    for (let i = 0; i < n; i++) {
      const u = i / (n - 1);
      // Fat in front, tapering to the tail.
      const r = 3.6 * Math.sin(Math.min(1, u * 1.15 + 0.12) * Math.PI) * (1 - u * 0.55) + 0.4;
      const g = new THREE.SphereGeometry(1, 16, 10);
      g.scale(r * 1.15, r * 0.85, 2.6);
      const m = new THREE.Mesh(g, body);
      const under = new THREE.Mesh(new THREE.SphereGeometry(1, 12, 8).scale(r * 0.9, r * 0.45, 2.3), belly);
      under.position.y = -r * 0.45;
      m.add(under);
      if (i % 2 === 0 && i < n - 2) {
        for (const s of [-1, 1]) {
          const spot = new THREE.Mesh(new THREE.SphereGeometry(0.22, 6, 4), spots);
          spot.position.set(s * r * 1.05, r * 0.1, 0);
          m.add(spot);
        }
      }
      this.root.add(m);
      this.segs.push(m);
    }
    // Pectoral fins and tail flukes.
    const finGeo = new THREE.PlaneGeometry(9, 3.2).translate(4.5, 0, 0);
    const finMat = new THREE.MeshStandardMaterial({ color: 0x223844, side: THREE.DoubleSide, fog: false, transparent: true, opacity: 0.85 });
    for (const s of [-1, 1]) {
      const f = new THREE.Mesh(finGeo, finMat);
      f.scale.x = s;
      f.rotation.x = -Math.PI / 2;
      this.segs[3].add(f);
      this.fins.push(f);
    }
    const fluke = new THREE.Mesh(new THREE.PlaneGeometry(10, 3.5), finMat);
    fluke.rotation.x = -Math.PI / 2;
    fluke.position.z = -2;
    this.segs[n - 1].add(fluke);
    this.fins.push(fluke);
    // Eyes.
    for (const s of [-1, 1]) {
      const eye = new THREE.Mesh(new THREE.SphereGeometry(0.35, 8, 6), spots);
      eye.position.set(s * 2.9, 0.6, 1.6);
      this.segs[0].add(eye);
    }
    this.fadeMats.push(body, belly, finMat);
    this.root.visible = false;
    this.root.traverse((o) => {
      o.frustumCulled = false;
      (o as THREE.Mesh).castShadow = false;
    });
    scene.add(this.root);
  }

  /** Swim past the Glass now (Bas points her out). */
  pass(): void {
    // Outside the Glass's window (east of the dock), crossing north to south.
    this.from.set(60, 6.5, 35);
    this.to.set(56, 3, -85);
    this.duration = 30;
    this.t = 0;
    this.root.visible = true;
  }

  update(dt: number, nearGlass: boolean): void {
    if (this.t < 0) {
      // Every so often she comes by on her own while someone is at the Glass.
      if (nearGlass) {
        this.nextAuto -= dt;
        if (this.nextAuto <= 0) {
          this.nextAuto = 80 + Math.random() * 40;
          this.pass();
        }
      }
      return;
    }
    this.t += dt;
    const k = this.t / this.duration;
    if (k >= 1) {
      this.t = -1;
      this.root.visible = false;
      return;
    }
    const time = this.t;
    // Head position along the path; the body follows with a sideways wave.
    const dir = this.tmp.copy(this.to).sub(this.from).normalize();
    const side = this.tmp2.set(-dir.z, 0, dir.x);
    const head = this.head.lerpVectors(this.from, this.to, k);
    for (let i = 0; i < this.segs.length; i++) {
      const s = this.segs[i];
      const back = i * 2.4;
      const wave = Math.sin(time * 1.1 - i * 0.45) * (0.4 + i * 0.12);
      s.position.copy(head).addScaledVector(dir, -back).addScaledVector(side, wave);
      s.position.y += Math.sin(time * 0.5 - i * 0.3) * 0.6;
      const yaw = Math.atan2(dir.x, dir.z) + Math.cos(time * 1.1 - i * 0.45) * 0.08 * (1 + i * 0.2);
      s.rotation.set(0, yaw, 0);
    }
    for (let i = 0; i < 2; i++) this.fins[i].rotation.z = Math.sin(time * 0.9 + i) * 0.35;
    this.fins[2].rotation.y = Math.sin(time * 1.1) * 0.3;
    // Fade in and out at the ends of the pass.
    const a = Math.min(1, Math.min(k, 1 - k) * 6);
    for (const m of this.fadeMats) m.opacity = 0.9 * a;
  }
}
