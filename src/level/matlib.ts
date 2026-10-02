import * as THREE from 'three';
import { levelMaterial, neonMaterial } from '../render/materials';
import {
  awningTexture, lapisTexture, metalTexture, plasterTexture, reliefTexture, sandstoneTexture,
  screenTexture, streetTextures, tileTexture, windowTexture, woodTexture,
} from './textures';

export type MatName =
  | 'sandstone' | 'sandstoneDark' | 'relief' | 'lapis' | 'gold' | 'basalt' | 'street'
  | 'tile' | 'metal' | 'darkMetal' | 'glass' | 'wood' | 'plasterTeal' | 'plasterOchre'
  | 'awningTeal' | 'awningRed' | 'concrete' | 'blackGlass' | 'trim' | 'rubber' | 'plant'
  | 'neonCyan' | 'neonPink' | 'neonGold' | 'neonRed' | 'neonGreen' | 'neonWhite' | 'neonViolet'
  | 'glowGlyph' | 'screen' | 'water' | 'windowWarm' | 'windowWarm2' | 'windowCool' | 'neonCyanDim' | 'pickupGlow';

/** Shared level materials, created once. */
export function createMaterials(caustics: boolean): Record<MatName, THREE.Material> {
  const c = caustics ? 1 : 0;
  const street = streetTextures();
  const glyph = reliefTexture(17, true);
  const m: Record<MatName, THREE.Material> = {
    sandstone: levelMaterial({ color: 0xffffff, map: sandstoneTexture(), roughness: 0.85, texScale: 4, caustics: 0.6 * c, name: 'sandstone' }),
    sandstoneDark: levelMaterial({ color: 0x9a8a78, map: sandstoneTexture('#a88f6c', '#6a5640', 11), roughness: 0.9, texScale: 4, caustics: 0.5 * c, name: 'sandstoneDark' }),
    relief: levelMaterial({ color: 0xffffff, map: reliefTexture(7), roughness: 0.85, texScale: 5, caustics: 0.6 * c, name: 'relief' }),
    lapis: levelMaterial({ color: 0xffffff, map: lapisTexture(), roughness: 0.35, metalness: 0.1, texScale: 3, caustics: 0.3 * c, envMapIntensity: 1.2, name: 'lapis' }),
    gold: levelMaterial({ color: 0xd4a640, roughness: 0.28, metalness: 1, caustics: 0.4 * c, envMapIntensity: 1.4, name: 'gold' }),
    basalt: levelMaterial({ color: 0x3a3a40, map: sandstoneTexture('#55555c', '#2a2a30', 13), roughness: 0.7, texScale: 4, caustics: 0.4 * c, name: 'basalt' }),
    street: levelMaterial({ color: 0xffffff, map: street.map, roughnessMap: street.rough, roughness: 0.9, metalness: 0.1, texScale: 6, caustics: 0.8 * c, envMapIntensity: 1.0, name: 'street' }),
    tile: levelMaterial({ color: 0xffffff, map: tileTexture(), roughness: 0.15, metalness: 0.3, texScale: 2, envMapIntensity: 1.5, caustics: 0.2 * c, name: 'tile' }),
    metal: levelMaterial({ color: 0xffffff, map: metalTexture(), roughness: 0.45, metalness: 0.75, texScale: 2, caustics: 0.3 * c, name: 'metal' }),
    darkMetal: levelMaterial({ color: 0x55585f, map: metalTexture(15), roughness: 0.5, metalness: 0.8, texScale: 2, caustics: 0.2 * c, name: 'darkMetal' }),
    glass: levelMaterial({ color: 0x8fd8ff, roughness: 0.05, metalness: 0.2, transparent: true, opacity: 0.25, envMapIntensity: 2, caustics: 0, name: 'glass', useUv: true }),
    wood: levelMaterial({ color: 0xffffff, map: woodTexture(), roughness: 0.65, texScale: 2, caustics: 0.4 * c, name: 'wood' }),
    plasterTeal: levelMaterial({ color: 0xffffff, map: plasterTexture('#2f6f6c', '#1c3f6a', 21), roughness: 0.9, texScale: 5, caustics: 0.5 * c, name: 'plasterTeal' }),
    plasterOchre: levelMaterial({ color: 0xffffff, map: plasterTexture('#b47a3c', '#2b4f8c', 22), roughness: 0.9, texScale: 5, caustics: 0.5 * c, name: 'plasterOchre' }),
    awningTeal: levelMaterial({ color: 0xffffff, map: awningTexture('#1f7c78', '#d9b45a'), roughness: 0.9, texScale: 2, caustics: 0.3 * c, side: THREE.DoubleSide, name: 'awningTeal' }),
    awningRed: levelMaterial({ color: 0xffffff, map: awningTexture('#8c2a2a', '#e0c070'), roughness: 0.9, texScale: 2, caustics: 0.3 * c, side: THREE.DoubleSide, name: 'awningRed' }),
    concrete: levelMaterial({ color: 0x6d6a66, map: sandstoneTexture('#77736d', '#5c5853', 23), roughness: 0.95, texScale: 6, caustics: 0.5 * c, name: 'concrete' }),
    blackGlass: levelMaterial({ color: 0x0a0c12, roughness: 0.08, metalness: 0.6, envMapIntensity: 1.8, caustics: 0, name: 'blackGlass' }),
    trim: levelMaterial({ color: 0x1a1c22, roughness: 0.5, metalness: 0.6, caustics: 0, name: 'trim' }),
    rubber: levelMaterial({ color: 0x121214, roughness: 0.9, caustics: 0, name: 'rubber' }),
    plant: levelMaterial({ color: 0x4f9a5a, roughness: 0.8, caustics: 0.3 * c, side: THREE.DoubleSide, name: 'plant' }),
    neonCyan: neonMaterial(0x30e0ff, 2.3),
    neonPink: neonMaterial(0xff3fa8, 2.3),
    neonGold: neonMaterial(0xffc04a, 2.1),
    neonRed: neonMaterial(0xff3020, 2.1),
    neonGreen: neonMaterial(0x40ff9a, 2.0),
    neonWhite: neonMaterial(0xfff4e0, 1.8),
    neonViolet: neonMaterial(0xa060ff, 2.1),
    windowWarm: new THREE.MeshBasicMaterial({ map: windowTexture(true), color: new THREE.Color(1.35, 1.35, 1.35) }),
    windowWarm2: new THREE.MeshBasicMaterial({ map: windowTexture(true, 47), color: new THREE.Color(1.2, 1.2, 1.2) }),
    neonCyanDim: neonMaterial(0x30e0ff, 1.2),
    pickupGlow: neonMaterial(0xfff0d0, 1.1),
    windowCool: new THREE.MeshBasicMaterial({ map: windowTexture(false, 53), color: new THREE.Color(1.15, 1.15, 1.15) }),
    glowGlyph: new THREE.MeshBasicMaterial({ map: glyph, color: new THREE.Color(1.6, 1.6, 1.6), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }),
    screen: new THREE.MeshBasicMaterial({ map: screenTexture(), color: new THREE.Color(1.3, 1.3, 1.3) }),
    water: new THREE.MeshStandardMaterial({ color: 0x0b3a4a, roughness: 0.05, metalness: 0.3, transparent: true, opacity: 0.85, envMapIntensity: 2 }),
  };
  return m;
}
