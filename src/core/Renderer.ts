import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { CONFIG, type QualityConfig, type QualityLevel } from '../config';

/**
 * WebGL renderer plus the post chain (bloom + output). Quality presets
 * change pixel ratio, shadows, bloom and MSAA at runtime.
 */
export class Renderer {
  readonly renderer: THREE.WebGLRenderer;
  quality: QualityLevel;
  q: QualityConfig;
  private composer: EffectComposer | null = null;
  private renderPass: RenderPass | null = null;
  private bloom: UnrealBloomPass | null = null;
  private width = 1;
  private height = 1;
  private qualityListeners: ((q: QualityConfig, level: QualityLevel) => void)[] = [];
  /** Draw calls and triangles of the last frame, across all passes. */
  readonly frameStats = { calls: 0, triangles: 0 };

  constructor(
    private readonly container: HTMLElement,
    quality: QualityLevel,
    private scene: THREE.Scene,
    private camera: THREE.PerspectiveCamera,
  ) {
    this.quality = quality;
    this.q = CONFIG.quality[quality];
    this.renderer = new THREE.WebGLRenderer({
      antialias: false,
      powerPreference: 'high-performance',
      stencil: false,
      preserveDrawingBuffer: false,
    });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 0.95;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.info.autoReset = false;
    this.renderer.domElement.id = 'game-canvas';
    this.renderer.domElement.tabIndex = 0;
    container.appendChild(this.renderer.domElement);
    window.addEventListener('resize', () => this.resize());
    this.applyQuality();
    this.resize();
  }

  get canvas(): HTMLCanvasElement {
    return this.renderer.domElement;
  }

  onQualityChange(l: (q: QualityConfig, level: QualityLevel) => void): void {
    this.qualityListeners.push(l);
  }

  setQuality(level: QualityLevel): void {
    if (level === this.quality) return;
    this.quality = level;
    this.q = CONFIG.quality[level];
    this.applyQuality();
    this.resize();
    for (const l of this.qualityListeners) l(this.q, level);
  }

  private applyQuality(): void {
    const q = this.q;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, q.pixelRatioMax));
    this.renderer.shadowMap.enabled = q.shadows;
    this.renderer.shadowMap.needsUpdate = true;
    // Material programs depend on shadow settings; force a recompile.
    this.scene.traverse((o) => {
      const m = (o as THREE.Mesh).material as THREE.Material | THREE.Material[] | undefined;
      if (!m) return;
      if (Array.isArray(m)) m.forEach((x) => (x.needsUpdate = true));
      else m.needsUpdate = true;
    });
    this.composer?.dispose();
    this.composer = null;
    this.bloom = null;
    if (q.bloom) {
      const size = this.renderer.getDrawingBufferSize(new THREE.Vector2());
      const rt = new THREE.WebGLRenderTarget(Math.max(1, size.x), Math.max(1, size.y), {
        type: THREE.HalfFloatType,
        samples: q.antialias ? 4 : 0,
      });
      this.composer = new EffectComposer(this.renderer, rt);
      this.renderPass = new RenderPass(this.scene, this.camera);
      this.composer.addPass(this.renderPass);
      this.bloom = new UnrealBloomPass(new THREE.Vector2(this.width, this.height), q.bloomStrength, 0.4, 1.0);
      this.composer.addPass(this.bloom);
      this.composer.addPass(new OutputPass());
    }
  }

  setBloomBoost(extra: number): void {
    if (this.bloom) this.bloom.strength = this.q.bloomStrength + extra;
  }

  resize(): void {
    this.width = this.container.clientWidth || window.innerWidth;
    this.height = this.container.clientHeight || window.innerHeight;
    this.renderer.setSize(this.width, this.height, false);
    this.renderer.domElement.style.width = '100%';
    this.renderer.domElement.style.height = '100%';
    this.camera.aspect = this.width / this.height;
    this.camera.updateProjectionMatrix();
    if (this.composer) {
      this.composer.setPixelRatio(this.renderer.getPixelRatio());
      this.composer.setSize(this.width, this.height);
    }
  }

  render(): void {
    this.renderer.info.reset();
    if (this.composer) this.composer.render();
    else this.renderer.render(this.scene, this.camera);
    this.frameStats.calls = this.renderer.info.render.calls;
    this.frameStats.triangles = this.renderer.info.render.triangles;
  }

  setScene(scene: THREE.Scene, camera: THREE.PerspectiveCamera): void {
    this.scene = scene;
    this.camera = camera;
    if (this.renderPass) {
      this.renderPass.scene = scene;
      this.renderPass.camera = camera;
    }
  }
}
