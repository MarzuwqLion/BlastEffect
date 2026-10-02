import * as THREE from 'three';
import type { LightAnchor } from '../level/LevelBuilder';

/**
 * A fixed number of real point lights, reassigned to the nearest light
 * anchors as the camera moves. Keeping the count constant means shaders
 * never recompile mid-game; anchors fade in and out smoothly.
 */
export class LightPool {
  private readonly anchors: LightAnchor[] = [];
  private lights: THREE.PointLight[] = [];
  private readonly targets: (LightAnchor | null)[] = [];
  private readonly fade: number[] = [];
  private readonly group = new THREE.Group();
  private time = 0;

  constructor(scene: THREE.Scene, count: number) {
    scene.add(this.group);
    this.setCount(count);
  }

  setCount(count: number): void {
    for (const l of this.lights) this.group.remove(l);
    this.lights = [];
    this.targets.length = 0;
    this.fade.length = 0;
    for (let i = 0; i < count; i++) {
      const l = new THREE.PointLight(0xffffff, 0, 10, 2);
      l.castShadow = false;
      this.group.add(l);
      this.lights.push(l);
      this.targets.push(null);
      this.fade.push(0);
    }
  }

  addAnchors(a: LightAnchor[]): void {
    this.anchors.push(...a);
  }

  /** Pick the anchors nearest the camera. */
  assign(cam: THREE.Vector3): void {
    const n = this.lights.length;
    const scored = this.anchors
      .map((a) => ({ a, d: a.pos.distanceToSquared(cam) / Math.max(1, a.intensity * a.distance * 0.1) }))
      .filter((x) => x.a.pos.distanceTo(cam) < 45)
      .sort((x, y) => x.d - y.d)
      .slice(0, n)
      .map((x) => x.a);
    // Keep lights that are still wanted in their slots to avoid popping.
    const free: number[] = [];
    for (let i = 0; i < n; i++) {
      const t = this.targets[i];
      if (t && scored.includes(t)) scored.splice(scored.indexOf(t), 1);
      else free.push(i);
    }
    for (const i of free) {
      const a = scored.shift() ?? null;
      if (a !== this.targets[i]) {
        this.targets[i] = a;
        this.fade[i] = 0;
      }
    }
  }

  update(dt: number): void {
    this.time += dt;
    for (let i = 0; i < this.lights.length; i++) {
      const l = this.lights[i];
      const a = this.targets[i];
      if (!a) {
        l.intensity = Math.max(0, l.intensity - dt * 20);
        continue;
      }
      this.fade[i] = Math.min(1, this.fade[i] + dt * 2.5);
      l.position.copy(a.pos);
      l.color.copy(a.color);
      l.distance = a.distance;
      let k = 1;
      if (a.flicker) k = 0.75 + 0.25 * Math.sin(this.time * 17 + a.pos.x) * Math.sin(this.time * 7.3 + a.pos.z);
      l.intensity = a.intensity * this.fade[i] * k;
    }
  }
}
