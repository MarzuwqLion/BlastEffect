import * as THREE from 'three';
import { buildPerson, cullAsPerson, type Look } from './people';
import { globalUniforms } from '../render/materials';

/** Mari, as her recordings show her: Imani's sister, field jacket, hair tied up, recorder in hand. */
const MARI: Look = {
  skin: 0x5a3a28, top: 0x2a5a66, trim: 0xd4a640, shirt: 0xd8cbb0, pants: 0x2a2a30, hair: 0x15100c,
  hairStyle: 'bun', height: 1.7, build: 0.95, outfit: 'jacket', accent: 0xd4a640, prop: 'tablet',
};

/**
 * Light instead of a body: additive, brightest at the silhouette, with
 * scanlines, a band that sweeps up it, and a flicker. Works on skinned
 * meshes (it is a basic material with a few lines injected).
 */
function holoMaterial(color: number): THREE.MeshBasicMaterial {
  const mat = new THREE.MeshBasicMaterial({ color, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false });
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = globalUniforms.uTime;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vHoloN;\nvarying vec3 vHoloV;\nvarying float vHoloY;')
      .replace(
        '#include <project_vertex>',
        `#include <project_vertex>
        vHoloV = normalize(-mvPosition.xyz);
        vHoloY = (modelMatrix * vec4(transformed, 1.0)).y;
        #ifdef USE_SKINNING
          vHoloN = normalize(transformedNormal);
        #else
          vHoloN = normalize(normalMatrix * normal);
        #endif`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float uTime;\nvarying vec3 vHoloN;\nvarying vec3 vHoloV;\nvarying float vHoloY;')
      .replace(
        '#include <opaque_fragment>',
        `float holoFres = pow(1.0 - abs(dot(normalize(vHoloN), normalize(vHoloV))), 1.5);
        float holoScan = 0.62 + 0.38 * sin(vHoloY * 150.0 - uTime * 5.0);
        float holoBand = smoothstep(0.93, 1.0, sin(vHoloY * 2.6 - uTime * 1.9));
        float holoFlick = 0.9 + 0.1 * sin(uTime * 31.0) * sin(uTime * 7.3);
        outgoingLight = diffuseColor.rgb * (0.16 + holoFres * 1.25 + holoBand * 0.7) * holoScan * holoFlick;
        #include <opaque_fragment>`,
      );
  };
  mat.customProgramCacheKey = () => 'holo-figure';
  return mat;
}

/**
 * A recording of Mari projected where she left it: she stands there
 * idling, turns to whoever comes near, talks while the recording plays,
 * then switches off.
 */
export class HoloFigure {
  readonly root = new THREE.Group();
  private readonly bones: Record<string, THREE.Bone>;
  private readonly material: THREE.MeshBasicMaterial;
  private time = Math.random() * 10;
  private speakT = 0;
  private offT = -1;
  private readonly baseYaw: number;
  private readonly world = new THREE.Vector3();
  /** Set once she has switched off. */
  done = false;

  constructor(scale = 1, yaw = 0) {
    const { mesh, bones } = buildPerson(MARI);
    this.bones = bones;
    this.material = holoMaterial(0x58dcff);
    mesh.material = this.material;
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    mesh.renderOrder = 4;
    cullAsPerson(mesh, MARI.height);
    this.root.add(mesh);
    this.root.scale.setScalar(scale);
    this.baseYaw = yaw;
    this.root.rotation.y = yaw;
  }

  /** The recording is playing: talk for this long, then switch off. */
  speak(seconds: number): void {
    this.speakT = seconds;
  }

  /** Already played (a saved game). */
  hide(): void {
    this.done = true;
    this.root.visible = false;
  }

  /** Back on (a checkpoint reload before it was found). */
  reset(): void {
    this.speakT = 0;
    this.offT = -1;
    this.done = false;
    this.root.visible = true;
    this.root.scale.y = this.root.scale.x;
    this.material.opacity = 1;
  }

  update(dt: number, viewer: THREE.Vector3): void {
    if (this.done) return;
    this.time += dt;
    const t = this.time;
    const B = this.bones;
    // Idle: weight on one hip, recorder held up in the left hand.
    B.hips.rotation.z = Math.sin(t * 0.4) * 0.03;
    B.spine.rotation.x = Math.sin(t * 1.5) * 0.012;
    B.chest.rotation.x = Math.sin(t * 1.5 + 0.4) * 0.016;
    B.upperArmL.rotation.set(-0.3, 0, -0.08);
    B.foreArmL.rotation.x = -1.15;
    B.upperArmR.rotation.set(0, 0, 0.08);
    B.foreArmR.rotation.x = -0.18;
    const talking = this.speakT > 0;
    if (talking) {
      this.speakT -= dt;
      B.jaw.rotation.x = Math.max(0, Math.sin(t * 13) * Math.sin(t * 5.3)) * 0.2;
      // Talking with her free hand.
      const g = Math.max(0, Math.sin(t * 2.3));
      B.upperArmR.rotation.x = -0.25 - g * 0.3;
      B.foreArmR.rotation.x = -0.7 - g * 0.55;
      B.head.rotation.z = Math.sin(t * 1.1) * 0.05;
      if (this.speakT <= 0) this.offT = 0;
    } else {
      B.jaw.rotation.x = 0;
    }
    // Turn to whoever is close; otherwise look where she was looking when she recorded it.
    this.root.getWorldPosition(this.world);
    const dx = viewer.x - this.world.x;
    const dz = viewer.z - this.world.z;
    const near = Math.hypot(dx, dz) < 9;
    let turn = (near ? Math.atan2(dx, dz) : this.baseYaw) - this.root.rotation.y;
    while (turn > Math.PI) turn -= Math.PI * 2;
    while (turn < -Math.PI) turn += Math.PI * 2;
    this.root.rotation.y += THREE.MathUtils.clamp(turn, -dt * 1.6, dt * 1.6);
    if (this.offT >= 0) {
      // Switch off: a flicker, then she collapses to a line.
      this.offT += dt;
      const k = Math.min(1, this.offT / 0.7);
      this.material.opacity = (1 - k) * (0.6 + 0.4 * Math.sin(this.offT * 70));
      this.root.scale.y = this.root.scale.x * (1 - k * k * 0.92);
      if (k >= 1) {
        this.done = true;
        this.root.visible = false;
      }
    }
  }
}
