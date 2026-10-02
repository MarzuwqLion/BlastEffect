import * as THREE from 'three';
import type { Avatar, AvatarEvent, AvatarState } from './types';

/** Graybox stand-in for the protagonist: a capsule with a facing marker. */
export class CapsuleAvatar implements Avatar {
  readonly object = new THREE.Group();
  private readonly body: THREE.Mesh;
  private crouch = 0;

  constructor() {
    const mat = new THREE.MeshStandardMaterial({ color: 0x2a5bd8, roughness: 0.5 });
    this.body = new THREE.Mesh(new THREE.CapsuleGeometry(0.36, 1.04, 6, 12), mat);
    this.body.position.y = 0.88;
    this.body.castShadow = true;
    const nose = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.15, 0.3), new THREE.MeshStandardMaterial({ color: 0xf2c418 }));
    nose.position.set(0, 1.45, -0.3);
    this.object.add(this.body, nose);
  }

  update(dt: number, s: AvatarState): void {
    this.object.rotation.y = s.yaw;
    const target = s.cover === 'low' && s.coverOut < 0.5 ? 1 : 0;
    this.crouch += (target - this.crouch) * Math.min(1, dt * 10);
    this.object.scale.y = 1 - this.crouch * 0.35;
  }

  trigger(_e: AvatarEvent): void {}

  muzzleWorld(out: THREE.Vector3): THREE.Vector3 {
    return out.set(0.25, 1.3, -0.6).applyMatrix4(this.object.matrixWorld);
  }

  chestWorld(out: THREE.Vector3): THREE.Vector3 {
    return out.set(0, 1.3, 0).applyMatrix4(this.object.matrixWorld);
  }

  jetWorld(out: THREE.Vector3, side: -1 | 1): THREE.Vector3 {
    return out.set(side * 0.15, 1.1, 0.3).applyMatrix4(this.object.matrixWorld);
  }

  headWorld(out: THREE.Vector3): THREE.Vector3 {
    return out.set(0, 1.62, 0).applyMatrix4(this.object.matrixWorld);
  }

  handWorld(out: THREE.Vector3, side: -1 | 1): THREE.Vector3 {
    return out.set(side * 0.3, 1.2, -0.4).applyMatrix4(this.object.matrixWorld);
  }

  lookAt(_t: THREE.Vector3 | null): void {}
  setTalking(_t: boolean): void {}
  setVisible(v: boolean): void {
    this.object.visible = v;
  }
  setOpacity(_o: number): void {}
}
