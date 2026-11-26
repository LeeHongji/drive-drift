// Audio: every level, frequency and time constant of the procedural sound (src/audio/). There are no audio
// files: one-shots are rendered into buffers at start-up from the recipes below, everything else is a live
// oscillator / noise graph. Mapping rules: docs/design/drift-gameplay.md §7.
//
// Units: gains are linear (1 = unity), frequencies Hz, times seconds, unless a name says dB or cents.
// A "time" on a continuous parameter is the time constant of its exponential glide (setTargetAtTime).
//
// LEVELS WERE SET WITHOUT LISTENING. The `gain` of each continuous source was chosen from an offline estimate
// of its RMS on the mix bus at full level (given in the comment as "≈ … rms"); the balance between sources is
// a starting point to tune by ear. Values are read live unless marked "(static)": static ones are applied
// when the graph is built and again by `audio.debug.retune()`.

/** A decaying sine partial of a one-shot. */
export interface ToneSpec {
  /** Start time in the sound, seconds. */
  at: number;
  /** Frequency, Hz; glides exponentially to `to` over `glide` seconds when both are given. */
  hz: number;
  to?: number;
  glide?: number;
  /** Decay time constant, seconds. */
  decay: number;
  /** Relative level (the whole sound is peak-normalised afterwards). */
  level: number;
  /** Attack ramp, seconds (default SFX.attack). */
  attack?: number;
}

/** A decaying burst of filtered noise in a one-shot. */
export interface NoiseSpec {
  at: number;
  /** Low-pass cutoff, Hz; glides exponentially to `to` over `glide` seconds when both are given. */
  hz: number;
  to?: number;
  glide?: number;
  decay: number;
  level: number;
  attack?: number;
  /** When set, the burst is band-passed: everything below `band`·cutoff is removed. */
  band?: number;
}

export interface SfxRecipe {
  /** Buffer length, seconds. */
  duration: number;
  /** Playback gain (the buffer itself peaks at SFX.peak). */
  volume: number;
  /** Random playback-rate range per trigger, [lo, hi]. */
  rate: [number, number];
  tones: ToneSpec[];
  noises: NoiseSpec[];
}

/** One engine wavetable: a harmonic series of the engine cycle (two crank turns) shaped by ENGINE.formants. */
export interface EngineLayer {
  /** rpm (0…1) this layer is voiced for: the formants are sampled at this rpm's harmonic frequencies. */
  ref: number;
  /** Layer gain on top of the crossfade weight. */
  gain: number;
  /** Level of the firing harmonics (5th engine order and its multiples: the pitch of the note). */
  firing: number;
  /** Level of the per-bank harmonics (2.5th order and its odd multiples: the V10 howl / growl). */
  bank: number;
  /** Level of every other harmonic of the cycle (roughness, lumpiness). */
  rough: number;
  /** Source roll-off above the firing frequency: amplitude ∝ (h / firing)^−tilt. */
  tilt: number;
  /** Phase scatter of the harmonics, 0…1: 0 = aligned (sharp exhaust pulses), 1 = fully random (smooth). */
  phaseSpread: number;
  /** Static detune against the other layers, cents: a few cents of slow beating while two layers overlap. */
  detune: number;
}

export const AUDIO = {
  master: {
    /** Output gain after the limiter. The limiter adds about +4 dB of make-up below its threshold. */
    volume: 0.45,
    /** Fade-in after the audio starts. */
    fadeIn: 0.3,
    /** Glide of the output gain while driving (tunnel lift). */
    gainTime: 0.1,
    /** Duck to silence on pause / mute / hidden tab, and the return. Short but click-free. */
    duckTime: 0.02,
    resumeTime: 0.05,
    /** The AudioContext is suspended this long after a duck starts (no audio CPU while paused or muted). */
    suspendDelay: 0.25,
    /** Output gain is multiplied by 1 + tunnelLift·tunnel. */
    tunnelLift: 0.25,
    /** High-pass on the mix: removes DC from the wave-shaper and sub-bass no speaker reproduces (static). */
    rumbleCut: 28,
  },

  /** Master compressor used as a safety limiter (static). dB, dB, ratio, seconds, seconds. */
  limiter: { threshold: -9, knee: 6, ratio: 12, attack: 0.003, release: 0.25 },

  noise: {
    /** Length of the one shared white-noise loop (static). Longer = less audible repetition, more memory. */
    seconds: 2.5,
    /** Seed of everything random in the audio (noise, impulse, wavetable phases, burble timing). */
    seed: 0x5e0d10,
    /** Q of the Butterworth low/high-pass filters, dB (Web Audio expresses low/high-pass Q in dB) (static). */
    flatQdB: -3,
  },

  engine: {
    /** Engine bus gain at redline on full throttle. ≈ 0.17 rms there, ≈ 0.10 on lift-off, ≈ 0.05 at idle. */
    gain: 0.34,
    /** Bus level = gain · (levelIdle + (1 − levelIdle)·rpm) · (off-throttle: levelOff … on: 1). */
    levelIdle: 0.62,
    levelOff: 0.9,
    /** Below this rpm (0…1) the pitch stops falling. */
    minRpm: 0.1,
    /** Pitch multiplier at full nitro ("slightly sharper"). */
    nitroPitch: 1.04,
    /** Harmonic of the engine cycle that is the firing frequency = number of cylinders (static). */
    firingHarmonic: 10,
    /** Wavetable size cap and the highest frequency a wavetable is given energy at, Hz (static). */
    maxHarmonics: 256,
    spectrumTop: 7000,
    /** RMS of every wavetable before its layer gain (static). */
    layerRms: 0.25,
    /**
     * Fixed resonances of intake, exhaust and cabin: [centre Hz, gain, width in octaves]. Each wavetable is
     * the harmonic series sampled through this envelope at its reference rpm, so crossfading the layers
     * sweeps the harmonics through fixed formants as a real engine does (static).
     */
    formants: [
      [330, 1.4, 0.9],
      [1150, 2.4, 0.55],
      [2500, 1.3, 0.45],
    ] as [number, number, number][],
    /** Envelope corners: first-order roll-off below lowCut, second-order above highCut, Hz (static). */
    lowCut: 75,
    highCut: 3800,
    /**
     * Wavetables: [0] is the idle voice (blended in by road speed), the rest are crossfaded by rpm in the
     * log domain with equal power. `ref` must rise from [1] on. `gain` is live, the rest is static.
     */
    layers: [
      // idle: lumpy and pulsed, strong per-bank and odd harmonics
      { ref: 0.12, gain: 0.8, firing: 1, bank: 0.85, rough: 0.3, tilt: 1.1, phaseSpread: 0.6, detune: 0 },
      // low: growl, the 2.5th order nearly as strong as the firing note
      { ref: 0.3, gain: 0.9, firing: 1, bank: 0.75, rough: 0.14, tilt: 1.0, phaseSpread: 1, detune: -2 },
      // mid: the firing note takes over, the howl stays underneath
      { ref: 0.58, gain: 0.9, firing: 1, bank: 0.55, rough: 0.08, tilt: 0.9, phaseSpread: 1, detune: 0 },
      // high: the V10 scream, mostly firing harmonics and a slower roll-off
      { ref: 0.9, gain: 1, firing: 1, bank: 0.4, rough: 0.05, tilt: 0.75, phaseSpread: 1, detune: 2 },
    ] as EngineLayer[],
    /** The idle voice fades out by this road speed, m/s; its share with the throttle down. */
    idleFadeSpeed: 4,
    idleOnThrottle: 0.4,
    /** Glides: pitch, layer crossfade, load (tone / drive), bus level. */
    pitchTime: 0.03,
    layerTime: 0.03,
    toneTime: 0.08,
    gainTime: 0.05,
    /** Bus low-pass cutoff with the throttle closed / open, Hz: muffled on lift-off, bright under load. */
    cutoffOff: 1800,
    cutoffOn: 9000,
    /** Gain into the soft-clipper with the throttle closed / open: more drive = more harmonics, louder. */
    driveOff: 0.8,
    driveOn: 1.5,
    /** Soft-clipper curve tanh(k·x) / tanh(k) (static). */
    shaperK: 1.6,
    /** Random pitch wobble, cents rms, and its bandwidth, Hz: cycle-to-cycle irregularity (static). */
    jitterCents: 5,
    jitterHz: 22,
    /** Intake rasp: band-passed noise multiplied by the engine waveform. Level at redline on full throttle. */
    rasp: 0.55,
    /** Rasp band centre at rpm 0 and the rise to redline, Hz; band Q (static). */
    raspHz: 1500,
    raspHzRange: 2200,
    raspQ: 0.8,
    /** Upshift: the engine ducks to shiftDuck with time constant shiftDown, recovers from shiftHold on with
     *  time constant shiftUp. */
    shiftDuck: 0.65,
    shiftDown: 0.008,
    shiftHold: 0.06,
    shiftUp: 0.03,
    /** Lift-off burble: throttle from above burbleFrom to below burbleTo, rpm above burbleRpm, speed above
     *  burbleSpeed m/s, not on nitro; at most one per burbleCooldown seconds. */
    burbleFrom: 0.5,
    burbleTo: 0.05,
    burbleRpm: 0.55,
    burbleSpeed: 15,
    burbleCooldown: 0.4,
  },

  /** Tyre screech: two resonant noise bands (the squeal) over a broad scrubbing band. Driven by frame.screech. */
  screech: {
    /** ≈ 0.07 rms at full screech. */
    gain: 1.1,
    /** Squeal band centres, Hz, and Q (static Q). Not a harmonic ratio on purpose. */
    hzA: 890,
    hzB: 1420,
    q: 15,
    /** Scrub band centre, Hz, Q and its level against the squeal bands (static Q and level). */
    scrubHz: 2500,
    scrubQ: 0.7,
    scrubLevel: 0.07,
    /** Band frequencies are multiplied by rateBase + rateRange·screech. */
    rateBase: 0.97,
    rateRange: 0.06,
    time: 0.15,
  },

  /** Wall scrape: two metallic resonances. Level = scrape · min(1, speed / fullSpeed). */
  scrape: {
    /** ≈ 0.10 rms at full level. */
    gain: 0.7,
    hzA: 1250,
    hzB: 3100,
    /** Q of both bands (static). */
    q: 4.5,
    /** Speed for full level, m/s. */
    fullSpeed: 20,
    /** Band frequencies are multiplied by 1 + rateRange·speedRatio. */
    rateRange: 0.15,
    /** Stereo position toward the wall, 0…1 (the chase camera looks along the car). */
    pan: 0.6,
    time: 0.04,
  },

  /** Road noise: low-passed noise. Level = min(1, speed / fullSpeed) · (0.5 + 0.5·speedRatio). */
  road: {
    /** ≈ 0.045 rms at top speed (0.05 at the nitro cap). */
    gain: 0.5,
    /** Cutoff, Hz, multiplied by rateBase + rateRange·speedRatio. */
    hz: 520,
    rateBase: 0.75,
    rateRange: 0.45,
    fullSpeed: 30,
    time: 0.15,
  },

  /** Wind: broad band-passed noise. Level = speedRatio². */
  wind: {
    /** ≈ 0.055 rms at top speed (0.07 at the nitro cap). */
    gain: 0.36,
    /** Band centre, Hz, multiplied by rateBase + rateRange·speedRatio; Q (static). */
    hz: 950,
    q: 0.5,
    rateBase: 0.85,
    rateRange: 0.3,
    time: 0.15,
  },

  /** Kerb rumble: a low-passed sawtooth at the rate the tyre crosses the kerb ribs. */
  kerb: {
    /** ≈ 0.075 rms at full level. */
    gain: 0.14,
    /** Rib spacing, metres: rumble frequency = speed / pitch, clamped to [minHz, maxHz]. */
    pitch: 0.5,
    minHz: 26,
    maxHz: 130,
    /** Low-pass cutoff, Hz (static). */
    cutoff: 480,
    /** Speed for full level, m/s (no rumble when parked on a kerb). */
    fullSpeed: 12,
    time: 0.03,
  },

  /** Nitro: a low roar that follows the smoothed boost level and a hiss that follows the button. */
  nitro: {
    /** Roar ≈ 0.08 rms at full boost with surge. */
    roarGain: 0.75,
    /** Roar band centre, Hz, and Q (static). */
    roarHz: 330,
    roarQ: 0.6,
    /** Share of the roar that only comes with the full-tank surge, 0…1. */
    surgeShare: 0.25,
    roarTime: 0.1,
    /** Hiss ≈ 0.035 rms while boosting. High-pass corner, Hz (static). */
    hissGain: 0.065,
    hissHz: 3500,
    hissAttack: 0.05,
    hissRelease: 0.2,
  },

  /** Outdoor ambience: soft low-passed noise with slow gusts, quieter at speed, silent in the tunnel. */
  ambience: {
    /** ≈ 0.015 rms standing still in a gust. */
    gain: 0.1,
    /** Low-pass cutoff, Hz (static). */
    cutoff: 1500,
    /** Level = (1 − tunnel) · (1 − speedDuck·min(1, speed / duckSpeed)) · (gustFloor + (1 − gustFloor)·gust). */
    speedDuck: 0.6,
    duckSpeed: 40,
    gustFloor: 0.4,
    /** Gusts per second (value-noise rate). */
    gustRate: 0.23,
    time: 0.5,
  },

  /** Snow-gallery acoustics, blended by frame.tunnel: reverb + echo fed from the whole mix. */
  tunnel: {
    /** Send into the wet path = wet · tunnel · (wetFloor + (1 − wetFloor)·speedRatio). */
    wet: 0.45,
    wetFloor: 0.4,
    /** Generated impulse: length (−60 dB point), and its low-pass corner at the start / end, Hz (static). */
    reverbTime: 1.8,
    brightHz: 7000,
    darkHz: 900,
    /** Gain after the (normalised) convolver (static). */
    reverbGain: 3,
    /** Echo: delay, feedback, low-pass in the loop, send into the wet bus (static). */
    echoDelay: 0.16,
    echoFeedback: 0.45,
    echoCutoff: 2500,
    echoGain: 0.6,
    /** Wet path resonance on the engine note: this harmonic of the cycle (5 = 2.5th order), dB, Q. */
    boomHarmonic: 5,
    boomDb: 8,
    boomQ: 3,
    /** Low shelf on the dry mix in the tunnel: corner Hz (static), gain dB at tunnel = 1. */
    shelfHz: 220,
    shelfDb: 5,
    time: 0.1,
    /** The wet path is disconnected (no convolution cost) this long after leaving the tunnel, seconds. */
    release: 3,
  },

  /** One-shots. Recipes are rendered once (static); `volume` and `rate` are read at every trigger. */
  sfx: {
    /** Peak every one-shot buffer is normalised to. */
    peak: 0.9,
    /** Default attack ramp of a tone or burst, and the fade at the end of every buffer, seconds. */
    attack: 0.003,
    fadeOut: 0.01,
    /** Glide of a one-shot's gain when a new trigger changes it. */
    gainTime: 0.004,
    /** impact(): normal speeds below crashMin m/s are silent; volume = min(1, speed / crashFull). */
    crashMin: 3,
    crashFull: 15,
    crashCooldown: 0.2,
    /** Link pitch: 2^((multiplier − 2) / linkStep) (×2 → 1.0, ×5 → 1.41). */
    linkStep: 6,
    /** Playback rate of the lap chime on a best lap (a major third up). */
    bestLapRate: 1.26,
    sounds: {
      /** Upshift: gear clack over a short driveline thump. */
      shift: {
        duration: 0.12,
        volume: 0.22,
        rate: [0.95, 1.05],
        tones: [{ at: 0, hz: 160, to: 70, glide: 0.05, decay: 0.03, level: 0.9 }],
        noises: [{ at: 0, hz: 3200, decay: 0.01, level: 1 }],
      },
      /** Lift-off burble: four irregular exhaust pops, each a dull crack over a short body tone. */
      burble: {
        duration: 0.5,
        volume: 0.32,
        rate: [0.9, 1.15],
        tones: [
          { at: 0, hz: 135, to: 85, glide: 0.04, decay: 0.026, level: 0.6 },
          { at: 0.072, hz: 120, to: 80, glide: 0.04, decay: 0.022, level: 0.4 },
          { at: 0.163, hz: 140, to: 85, glide: 0.04, decay: 0.026, level: 0.5 },
          { at: 0.291, hz: 115, to: 75, glide: 0.04, decay: 0.02, level: 0.28 },
        ],
        noises: [
          { at: 0, hz: 1500, to: 500, glide: 0.03, decay: 0.014, level: 1 },
          { at: 0.072, hz: 1300, to: 450, glide: 0.03, decay: 0.012, level: 0.65 },
          { at: 0.163, hz: 1600, to: 500, glide: 0.03, decay: 0.015, level: 0.85 },
          { at: 0.291, hz: 1100, to: 400, glide: 0.03, decay: 0.011, level: 0.45 },
        ],
      },
      /** Wall hit: body thud, a crunch that darkens quickly, three short panel resonances, falling debris. */
      crash: {
        duration: 0.6,
        volume: 0.8,
        rate: [0.9, 1.1],
        tones: [
          { at: 0, hz: 95, to: 42, glide: 0.12, decay: 0.09, level: 1 },
          { at: 0, hz: 430, decay: 0.08, level: 0.22 },
          { at: 0, hz: 1170, decay: 0.06, level: 0.16 },
          { at: 0, hz: 1930, decay: 0.045, level: 0.1 },
        ],
        noises: [
          { at: 0, hz: 3800, to: 500, glide: 0.15, decay: 0.07, level: 0.9 },
          { at: 0.05, hz: 6000, decay: 0.12, level: 0.18, band: 0.4, attack: 0.02 },
        ],
      },
      /** Drift linked: a bright bell note (A5 at ×2) with a pick transient; pitched up with the multiplier. */
      link: {
        duration: 0.35,
        volume: 0.28,
        rate: [1, 1],
        tones: [
          { at: 0, hz: 880, decay: 0.09, level: 1 },
          { at: 0, hz: 1760, decay: 0.06, level: 0.45 },
          { at: 0, hz: 2648, decay: 0.04, level: 0.2 },
        ],
        noises: [{ at: 0, hz: 6000, decay: 0.004, level: 0.3 }],
      },
      /** Chain banked: a rising major arpeggio C5 E5 G5 C6, each note with its octave. */
      bank: {
        duration: 0.65,
        volume: 0.3,
        rate: [1, 1],
        tones: [
          { at: 0, hz: 523.3, decay: 0.14, level: 0.8 },
          { at: 0, hz: 1046.5, decay: 0.08, level: 0.25 },
          { at: 0.055, hz: 659.3, decay: 0.14, level: 0.8 },
          { at: 0.055, hz: 1318.5, decay: 0.08, level: 0.25 },
          { at: 0.11, hz: 784, decay: 0.15, level: 0.8 },
          { at: 0.11, hz: 1568, decay: 0.08, level: 0.25 },
          { at: 0.165, hz: 1046.5, decay: 0.2, level: 1 },
          { at: 0.165, hz: 2093, decay: 0.1, level: 0.25 },
        ],
        noises: [],
      },
      /** Chain wiped: a buzzy tone falling two octaves over a dull noise sweep. */
      wipe: {
        duration: 0.45,
        volume: 0.2,
        rate: [1, 1],
        tones: [
          { at: 0, hz: 240, to: 65, glide: 0.3, decay: 0.13, level: 1, attack: 0.008 },
          { at: 0, hz: 480, to: 130, glide: 0.3, decay: 0.11, level: 0.4, attack: 0.008 },
          { at: 0, hz: 720, to: 195, glide: 0.3, decay: 0.09, level: 0.2, attack: 0.008 },
        ],
        noises: [{ at: 0, hz: 900, to: 200, glide: 0.3, decay: 0.1, level: 0.3, attack: 0.008 }],
      },
      /** Lap completed: two chime notes a fifth apart (E5, B5), each with its octave. */
      lap: {
        duration: 0.9,
        volume: 0.3,
        rate: [1, 1],
        tones: [
          { at: 0, hz: 659.3, decay: 0.2, level: 0.9 },
          { at: 0, hz: 1318.5, decay: 0.1, level: 0.25 },
          { at: 0.13, hz: 987.8, decay: 0.28, level: 1 },
          { at: 0.13, hz: 1975.5, decay: 0.14, level: 0.25 },
        ],
        noises: [],
      },
      /** Shard collected: a quick upward chirp with its octave. */
      pickup: {
        duration: 0.22,
        volume: 0.2,
        rate: [0.97, 1.03],
        tones: [
          { at: 0, hz: 1250, to: 2500, glide: 0.09, decay: 0.06, level: 1 },
          { at: 0, hz: 2500, to: 5000, glide: 0.09, decay: 0.04, level: 0.3 },
        ],
        noises: [],
      },
      /** Tank full: two soft rising beeps (E6, A6). */
      full: {
        duration: 0.32,
        volume: 0.16,
        rate: [1, 1],
        tones: [
          { at: 0, hz: 1318.5, decay: 0.05, level: 0.8, attack: 0.006 },
          { at: 0.09, hz: 1760, decay: 0.08, level: 1, attack: 0.006 },
        ],
        noises: [],
      },
      /** Nitro ignition: a whoosh opening upward over a low thump. */
      nitro: {
        duration: 0.7,
        volume: 0.38,
        rate: [0.96, 1.04],
        tones: [{ at: 0, hz: 70, to: 45, glide: 0.2, decay: 0.12, level: 0.7, attack: 0.008 }],
        noises: [{ at: 0, hz: 500, to: 5000, glide: 0.25, decay: 0.2, level: 1, band: 0.35, attack: 0.03 }],
      },
    } as Record<SfxName, SfxRecipe>,
  },
};

export type SfxName = 'shift' | 'burble' | 'crash' | 'link' | 'bank' | 'wipe' | 'lap' | 'pickup' | 'full' | 'nitro';
