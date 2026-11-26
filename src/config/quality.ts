// Quality presets (docs/design/rendering-and-camera.md §3). Modules read the active preset through
// `QUALITY`; it is chosen once before the world is built (`?q=low|normal|high|ultra`, default by device).
// Switching at runtime only changes resolution; everything else applies on the next load.

export interface QualityPreset {
  name: 'low' | 'normal' | 'high' | 'ultra';
  /** Device pixel ratio cap. */
  pixelRatio: number;
  /** MSAA samples for the HDR scene target. */
  msaa: number;
  shadowResolution: number;
  shadowCascades: number;
  /** Sun shadow distance, metres. */
  shadowDistance: number;
  /** Road planar reflection resolution as a fraction of the screen; 0 = off (environment reflection only). */
  reflectionScale: number;
  /** Volumetric fog ray steps (0 = off) and resolution scale. */
  fogSteps: number;
  fogScale: number;
  /** Grass blades per square metre and draw distance, metres. */
  grassDensity: number;
  grassDistance: number;
  /** Lens droplets and speed blur. */
  lensEffects: boolean;
  /** Volumetric cloud quality: 0 off, 1 low, 2 medium, 3 high. */
  clouds: number;
}

export const QUALITY_PRESETS: Record<QualityPreset['name'], QualityPreset> = {
  low: { name: 'low', pixelRatio: 1, msaa: 1, shadowResolution: 1024, shadowCascades: 1, shadowDistance: 120, reflectionScale: 0, fogSteps: 0, fogScale: 0.2, grassDensity: 120, grassDistance: 120, lensEffects: false, clouds: 0 },
  normal: { name: 'normal', pixelRatio: 1, msaa: 2, shadowResolution: 2048, shadowCascades: 2, shadowDistance: 200, reflectionScale: 0.3, fogSteps: 0, fogScale: 0.25, grassDensity: 220, grassDistance: 180, lensEffects: true, clouds: 1 },
  high: { name: 'high', pixelRatio: 1.5, msaa: 4, shadowResolution: 2048, shadowCascades: 2, shadowDistance: 240, reflectionScale: 0.4, fogSteps: 5, fogScale: 0.25, grassDensity: 380, grassDistance: 240, lensEffects: true, clouds: 2 },
  ultra: { name: 'ultra', pixelRatio: 2, msaa: 4, shadowResolution: 4096, shadowCascades: 3, shadowDistance: 300, reflectionScale: 0.5, fogSteps: 8, fogScale: 0.35, grassDensity: 380, grassDistance: 300, lensEffects: true, clouds: 3 },
};

/** The active preset. Mutated in place by `setQuality` so imports stay valid. */
export const QUALITY: QualityPreset = { ...QUALITY_PRESETS.normal };

export function setQuality(name: string | null): void {
  const preset = QUALITY_PRESETS[(name ?? '') as QualityPreset['name']];
  if (preset) Object.assign(QUALITY, preset);
}
