/**
 * Synthesized interface sounds for the board - no audio files, everything
 * built from Web Audio oscillators and filtered noise.
 *
 * Sounds mark EVENTS THAT CHANGED THE PLAN (a card landing, a wire snapping
 * in or refusing, a knob turning), never raw UI interaction: a global
 * every-button tick was tried and rejected as noise. The vocabulary lives in
 * `playBoardSound`'s switch; who calls what is the watcher's business
 * (`use-board-sound-effects.ts`) plus the one gesture hook for refusals.
 *
 * Three hard-won rules keep them clean:
 * - Every envelope RAMPS in over a few ms and ramps fully out. A gain that
 *   steps straight to its peak is a click stacked on the note - that was
 *   the first version's "clicky" sound.
 * - Nothing is scheduled against a suspended AudioContext. The context
 *   suspends whenever the tab loses focus or autoplay policy holds it, and
 *   notes scheduled while suspended play late, clipped, or not at all -
 *   that was the "sometimes I don't hear it" bug. `playBoardSound` resumes
 *   first and schedules in the resume callback.
 * - The output stream is KEPT HOT. Chrome (Windows especially) parks the
 *   hardware audio stream after a few seconds of silence while
 *   `currentTime` keeps running, and a 100ms note scheduled into the
 *   wake-up gap is clipped or lost entirely - which reads as "the first
 *   sound played, then nothing". An inaudible constant source holds the
 *   stream open, and every note starts a beat after "now" so it never
 *   begins mid-wakeup.
 * - Fundamentals sit at 200Hz+ (laptop speakers roll off below), and the
 *   whole mix runs through one gentle lowpass so nothing spits.
 * - FIREFOX HANDS THE GRAPH ITS ORDERS AT THE END OF THE TASK. Gecko queues
 *   every node creation, connection and start() and flushes the queue to
 *   the audio thread only when the current task finishes; Chrome's audio
 *   thread picks them up at once. So a note scheduled 30ms ahead by a
 *   click that then solves or renders for 600ms in the same task is, in
 *   Firefox, never heard - its whole envelope is in the past by the time
 *   the graph sees it - and a 150ms hang clips its first 120ms (measured
 *   2026-09-08 with a MediaRecorder on the real output: Chrome played
 *   whole through both, Firefox lost or clipped them, and yielding one
 *   macrotask before the hang played whole). Hence `playBoardSound` on
 *   Gecko schedules from a macrotask of its own, whatever the caller does
 *   next; and callers that can, play first and mutate in a later task
 *   (the mode keys), which puts the note on time as well as whole.
 */

const KEY = "gtnh-factory-flow.board-sounds.v1";
const VOLUME_KEY = "gtnh-factory-flow.board-sounds-volume.v1";

/** The default master volume; the settings slider works in this scale. */
export const DEFAULT_BOARD_SOUND_VOLUME = 0.5;

export function areBoardSoundsEnabled(): boolean {
  try {
    return window.localStorage.getItem(KEY) !== "off";
  } catch {
    return true;
  }
}

export function setBoardSoundsEnabled(enabled: boolean): void {
  try {
    if (enabled) {
      window.localStorage.removeItem(KEY);
    } else {
      window.localStorage.setItem(KEY, "off");
    }
  } catch {
    // A blocked quota must never break the app.
  }
}

/** Master volume, 0..1. Applied live: a slider drag is audible immediately. */
export function getBoardSoundVolume(): number {
  try {
    const raw = window.localStorage.getItem(VOLUME_KEY);
    if (raw === null) {
      return DEFAULT_BOARD_SOUND_VOLUME;
    }
    const value = Number(raw);
    return Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : DEFAULT_BOARD_SOUND_VOLUME;
  } catch {
    return DEFAULT_BOARD_SOUND_VOLUME;
  }
}

export function setBoardSoundVolume(volume: number): void {
  const clamped = Math.min(1, Math.max(0, volume));
  try {
    if (clamped === DEFAULT_BOARD_SOUND_VOLUME) {
      window.localStorage.removeItem(VOLUME_KEY);
    } else {
      window.localStorage.setItem(VOLUME_KEY, String(clamped));
    }
  } catch {
    // A blocked quota must never break the app.
  }
  if (masterGain) {
    masterGain.gain.value = clamped;
  }
}

/**
 * A LOADED plan is not an action. Hydration, tab switches and setup opens
 * can land a plan's content in a follow-up write that keeps the project id,
 * and the diff watcher cannot tell that arrival from a giant paste - so the
 * loading paths declare a quiet spell here and the engine sits it out.
 */
let quietUntil = 0;

export function quietBoardSoundsFor(ms: number): void {
  if (typeof performance === "undefined") {
    return;
  }
  quietUntil = Math.max(quietUntil, performance.now() + ms);
}

/**
 * Mute ONE kind for a moment. The gesture hooks that play their own voice
 * (the tier chips' dialPower) use this to keep the diff watcher's generic
 * adjust tap from doubling them - muting everything instead silenced the
 * very next wheel tick's own voice, which read as "fast scrolling is
 * broken".
 */
const kindQuietUntil = new Map<BoardSoundKind, number>();

export function suppressBoardSound(kind: BoardSoundKind, ms: number): void {
  if (typeof performance === "undefined") {
    return;
  }
  kindQuietUntil.set(kind, Math.max(kindQuietUntil.get(kind) ?? 0, performance.now() + ms));
}

export type BoardSoundKind =
  | "checklistOn" | "checklistOff" | "checklistCheck" | "checklistRestore"
  | "place" // a machine card lands: one flat thump
  | "placeProduct" // a drawer spawns to CATCH a product: thump stepping down
  | "placeSource" // a drawer spawns to SUPPLY something: thump stepping up
  | "delete" // a card leaves the board
  | "connect" // a wire snaps in
  | "zap" // a POWER wire snaps in: a crackle of electricity
  | "zapOff" // a POWER wire (or its drawer) goes: the discharge
  | "snap" // the dragged wire catches a compatible slot mid-drag
  | "unwire" // a wire is cut
  | "error" // a wire drop was refused
  | "open" // a board window unfolds from its summary card
  | "close" // a board window folds to its summary card
  | "adjust" // a setting on a card changed: machine count, drain pill, config
  | "drawerOverflow" // non-strict: a soft sliding release
  | "drawerStrict" // strict: a firm, dry latch
  | "drawerRatio" // ratio: three measured taps opening into a split
  | "sweep" // one sound for a bulk change (paste, arrange, import)
  | "solveOn" // the board shifts into solve mode: a relay engaging, short and dry
  | "solveOff" // and back to plan mode: the same shimmer, settling home
  | "buildOn" // back to build mode: a block set down, low and dry
  | "poolOn" // the board pools its resources: a drop into still water
  | "poolOff" // (unused since the mode switch; kept for older callers)
  // The build timelapse's family (board-timelapse.ts): the same events as
  // place/connect/open, but SLID rather than set down - mostly brush, a
  // whisper of tone - because dozens fire in a row and the thump family
  // sums into a drum solo at that rate.
  | "shuffle" // a card slides onto the table
  | "shuffleWire" // its wires brush in
  | "shuffleBoard" // a frame is drawn around finished cards
  | "dialRate" // the rate unit dial: one tap, pitched by the chosen step
  | "dialEnergy" // the rate dial landing on EU per unit: a coin, not a tap
  | "dialPower" // the power unit dial: a tap that grows with the tier
  // The recipe search's family (Jack, 2026-09-02): the one place off the
  // canvas that sounds, because it is a screen of its own with pages to
  // turn. All quiet, all brush-first, none of them a thump.
  | "pageOpen" // the search opens: a leaf lifted
  | "pageClose" // and closes: the leaf laid down
  | "pageTurn" // a new page while open: a chip clicked, back, forward
  | "tick" // a switch on the page: machine chip, rate pill, any/all/only
  | "stencilAdd" // a condition joins the stencil
  | "stencilRemove" // a condition leaves it
  // The library's family (Jack, 2026-09-04): the search's two sounds were
  // too bright for a room you live in. Lower, quieter, and its own.
  | "shelfTurn" // a view or a focus page changes: a card slid along the shelf
  | "shelfTick"; // a filter or sort changes: a low key

let audioContext: AudioContext | undefined;
let masterGain: GainNode | undefined;
let noiseBuffer: AudioBuffer | undefined;
const lastPlayedAt = new Map<BoardSoundKind, number>();

/**
 * RETRIGGER STEALS, never stacks and never drops. Playing a kind that is
 * already sounding fades the old voice out in a few ms and starts fresh -
 * the way every game UI does it. The alternatives both failed in use: let
 * voices overlap and rapid deletes SUM their 250ms tails into a crescendo;
 * throttle repeats away and rapid deletes lose their feedback entirely
 * ("some sounds don't play"). One live voice per kind, so a burst of the
 * same action sounds like a fast drum roll at one volume.
 */
const activeVoices = new Map<BoardSoundKind, GainNode>();

/** Only a same-frame duplicate is dropped outright. */
const DEDUPE_MS = 30;

/** How fast a stolen voice gets out of the way. */
const STEAL_FADE = 0.015;

/**
 * Fast REPEATS duck. Even with stealing, a burst of full-volume retriggers
 * (wheel-scrolling a tier chip) reads two or three times louder than one
 * note - the ear sums repeated pulses inside ~200ms. So repeats inside
 * this window play progressively quieter, like an OS scroll tick, and the
 * first note after a pause is back at full voice. The window is deliberately
 * TIGHT: wheel steps arrive every 30-80ms, but two deliberate actions in
 * quick succession can be 150ms apart, and ducking those read as broken
 * volume rather than as a scroll tick.
 */
const REPEAT_WINDOW_MS = 120;
const REPEAT_DUCK = 0.6;
const REPEAT_DUCK_FLOOR = 3;
const repeatStreak = new Map<BoardSoundKind, number>();

/**
 * Every note fades in over this long; instant attacks click, and even a
 * clean 5ms onset reads as hard-edged - 10ms is where the notes stop
 * sounding struck and start sounding placed.
 */
const ATTACK = 0.01;

/**
 * Notes start this far after "now". Scheduling AT currentTime asks the
 * graph to begin a 5ms attack in the past by the time it renders, which
 * eats the front of the note.
 */
const SCHEDULE_AHEAD = 0.03;

/**
 * Gecko flushes audio graph commands at the end of the task (header). Only
 * Firefox's UA carries "Gecko/<date>"; Chrome and Safari say "like Gecko".
 */
const DEFERS_GRAPH_COMMANDS_TO_TASK_END =
  typeof navigator !== "undefined" && /\bGecko\/\d/.test(navigator.userAgent);

function getContext(): AudioContext | undefined {
  if (typeof window === "undefined") {
    return undefined;
  }
  // A context can die under us (device switch, "closed" state); a dead one
  // is discarded and rebuilt rather than silently swallowing every note.
  if (audioContext && audioContext.state === "closed") {
    audioContext = undefined;
    masterGain = undefined;
    noiseBuffer = undefined;
    // These voices belong to the dead context; stealing them from the new
    // one would schedule ramps on a foreign clock.
    activeVoices.clear();
  }
  if (!audioContext) {
    try {
      audioContext = new AudioContext();
      masterGain = audioContext.createGain();
      // The one master volume. Everything below is relative to this.
      masterGain.gain.value = getBoardSoundVolume();
      // A soft roof over the whole mix: synthesized edges high up are what
      // makes little UI notes sound cheap and spitty. 5.5kHz keeps the
      // presence band (1-4kHz) intact - loudness LIVES there, and an
      // earlier 3.2kHz roof was part of why everything read as faint.
      const roof = audioContext.createBiquadFilter();
      roof.type = "lowpass";
      roof.frequency.value = 4500;
      // Overload protection must be STATELESS. A DynamicsCompressor here
      // made identical actions play at different volumes: its ~100ms
      // release meant a sound landing shortly after another went through
      // partially-engaged gain reduction while an isolated one did not.
      // A tanh soft-clip shapes each sample on its own - no memory, so
      // the same note is always the same loudness, and a rare overlap
      // rounds off instead of clipping.
      const softClip = audioContext.createWaveShaper();
      const curve = new Float32Array(1024);
      for (let i = 0; i < curve.length; i += 1) {
        const x = (i / (curve.length - 1)) * 2 - 1;
        // Unity slope at zero (transparent at normal levels), saturating
        // toward ~0.83 as overlaps push past full scale.
        curve[i] = Math.tanh(x * 1.2) / 1.2;
      }
      softClip.curve = curve;
      softClip.oversample = "2x";
      masterGain.connect(roof);
      roof.connect(softClip);
      softClip.connect(audioContext.destination);
      // The keep-alive: an inaudible DC-ish hum that never stops, so the
      // hardware output stream never parks between sounds. Routed straight
      // to the destination - it must survive the master volume at zero.
      const keepAlive = audioContext.createConstantSource();
      const keepAliveGain = audioContext.createGain();
      keepAliveGain.gain.value = 0.0001;
      keepAlive.connect(keepAliveGain);
      keepAliveGain.connect(audioContext.destination);
      keepAlive.start();
    } catch {
      return undefined;
    }
  }
  return audioContext;
}

/** A short white-noise buffer, built once, reused by every puff. */
function getNoiseBuffer(ctx: AudioContext): AudioBuffer {
  if (!noiseBuffer) {
    const length = Math.floor(ctx.sampleRate * 0.25);
    noiseBuffer = ctx.createBuffer(1, length, ctx.sampleRate);
    const data = noiseBuffer.getChannelData(0);
    for (let i = 0; i < length; i += 1) {
      data[i] = Math.random() * 2 - 1;
    }
  }
  return noiseBuffer;
}

/**
 * Fade in over ATTACK, decay with a BODY, end at true zero. The body stage
 * (down to a third of peak at mid-duration, then out) matters for loudness:
 * the ear integrates over ~150ms, so a note that is all attack measures
 * loud on a scope and still sounds like a faint tap.
 */
function shapeEnvelope(gain: AudioParam, t0: number, peak: number, duration: number): void {
  gain.setValueAtTime(0.0001, t0);
  gain.linearRampToValueAtTime(peak, t0 + ATTACK);
  gain.exponentialRampToValueAtTime(peak * 0.35, t0 + duration * 0.45);
  gain.exponentialRampToValueAtTime(0.002, t0 + duration);
  gain.linearRampToValueAtTime(0, t0 + duration + 0.015);
}

interface BlipOptions {
  /** Start frequency in Hz. */
  from: number;
  /** End frequency; equal to `from` for a flat note. */
  to: number;
  /** Seconds from the scheduled start. */
  delay?: number;
  duration: number;
  peak: number;
}

/**
 * One enveloped note - a ROUNDED tone, not a beep. Raw oscillator types
 * (triangle especially) all read as beeps whatever the envelope does. The
 * tone here is a sine fundamental with a quiet, slightly-detuned octave
 * partial for body, through a per-note lowpass that tracks the pitch - the
 * soft mallet-on-wood family rather than the alarm family. Pitch contours
 * stay exactly as the voice tables state them.
 */
function blip(ctx: AudioContext, out: AudioNode, options: BlipOptions): void {
  const t0 = ctx.currentTime + SCHEDULE_AHEAD + (options.delay ?? 0);
  // A few cents of drift so repeated actions never sound stamped out.
  const drift = 1 + (Math.random() - 0.5) * 0.03;
  const gain = ctx.createGain();
  const rounder = ctx.createBiquadFilter();
  rounder.type = "lowpass";
  rounder.frequency.value = Math.min(options.from * 3.5, 3000);
  rounder.Q.value = 0.5;
  shapeEnvelope(gain.gain, t0, options.peak, options.duration);
  rounder.connect(gain);
  gain.connect(out);
  const partials = [
    { multiple: 1, level: 1 },
    { multiple: 2.004, level: 0.22 },
  ];
  for (const partial of partials) {
    const osc = ctx.createOscillator();
    osc.type = "sine";
    const partialGain = ctx.createGain();
    partialGain.gain.value = partial.level;
    osc.frequency.setValueAtTime(options.from * drift * partial.multiple, t0);
    if (options.to !== options.from) {
      osc.frequency.exponentialRampToValueAtTime(
        options.to * drift * partial.multiple,
        t0 + options.duration,
      );
    }
    osc.connect(partialGain);
    partialGain.connect(rounder);
    osc.start(t0);
    osc.stop(t0 + options.duration + 0.03);
  }
}

/**
 * The ETHEREAL material, for the two mode-shift sounds only: a slow-swelled
 * chord of detuned sines (fundamental pair, a fifth, a whisper of octave)
 * gliding as one, through the same pitch-tracking lowpass the blips use. The
 * swell is what separates it from the whole percussive vocabulary - nothing
 * else on the board fades IN - so it reads as the room changing rather than
 * a thing being placed. Deliberately soft-topped: shifting dimensions must
 * never read as an alarm.
 */
function shimmerPad(
  ctx: AudioContext,
  out: AudioNode,
  options: { from: number; to: number; duration: number; peak: number },
): void {
  const t0 = ctx.currentTime + SCHEDULE_AHEAD;
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0.0001, t0);
  gain.gain.linearRampToValueAtTime(options.peak, t0 + 0.08);
  gain.gain.exponentialRampToValueAtTime(options.peak * 0.45, t0 + options.duration * 0.6);
  gain.gain.exponentialRampToValueAtTime(0.002, t0 + options.duration);
  gain.gain.linearRampToValueAtTime(0, t0 + options.duration + 0.03);
  const rounder = ctx.createBiquadFilter();
  rounder.type = "lowpass";
  rounder.frequency.value = 2600;
  rounder.Q.value = 0.4;
  rounder.connect(gain);
  gain.connect(out);
  // Two detuned fundamentals beat gently against each other - that slow
  // interference is the "shimmer"; the fifth gives it a chord's calm.
  const layers = [
    { multiple: 1, detune: -5, level: 0.45 },
    { multiple: 1, detune: 6, level: 0.45 },
    { multiple: 1.498, detune: 3, level: 0.26 },
    { multiple: 2.004, detune: -4, level: 0.12 },
  ];
  for (const layer of layers) {
    const osc = ctx.createOscillator();
    osc.type = "sine";
    osc.detune.value = layer.detune;
    const layerGain = ctx.createGain();
    layerGain.gain.value = layer.level;
    osc.frequency.setValueAtTime(options.from * layer.multiple, t0);
    osc.frequency.exponentialRampToValueAtTime(
      options.to * layer.multiple,
      t0 + options.duration * 0.7,
    );
    osc.connect(layerGain);
    layerGain.connect(rounder);
    osc.start(t0);
    osc.stop(t0 + options.duration + 0.05);
  }
}

/** A filtered puff of noise: the knock and brush material. */
function puff(
  ctx: AudioContext,
  out: AudioNode,
  options: { frequency: number; q?: number; duration: number; peak: number; delay?: number },
): void {
  const t0 = ctx.currentTime + SCHEDULE_AHEAD + (options.delay ?? 0);
  const source = ctx.createBufferSource();
  source.buffer = getNoiseBuffer(ctx);
  // A random start point so two puffs never replay the identical grains.
  const offset = Math.random() * 0.1;
  const filter = ctx.createBiquadFilter();
  filter.type = "bandpass";
  filter.frequency.value = options.frequency;
  filter.Q.value = options.q ?? 1.2;
  const gain = ctx.createGain();
  shapeEnvelope(gain.gain, t0, options.peak, options.duration);
  source.connect(filter);
  filter.connect(gain);
  gain.connect(out);
  source.start(t0, offset);
  source.stop(t0 + options.duration + 0.03);
}

/**
 * The voices. Tuning lesson learned the hard way: short pure sines below
 * 300Hz are perceptually near-silent whatever their amplitude. Loudness
 * needs duration (the body stage of the envelope), harmonics (triangle
 * over sine), and some energy above 500Hz. Every voice carries all three.
 */
function schedule(kind: BoardSoundKind, ctx: AudioContext, out: AudioNode, step = 0): void {
  switch (kind) {
    case "dialRate": {
      // A ladder as a pitch ladder - one quiet PURE tap, wood not
      // electricity, so it can never be mistaken for the voltage dial by
      // ear. The old four-entry table (262/330/415/523) was exactly a 1.26
      // ratio per rung; the formula keeps those notes and extends the climb
      // to rung 10, fractional rungs included, so a counter walking up
      // audibly walks UP instead of looping a four-note melody.
      const rung = Math.max(0, Math.min(10, step));
      const frequency = 262 * Math.pow(1.26, rung);
      blip(ctx, out, { from: frequency, to: frequency, duration: 0.09, peak: 0.18 });
      break;
    }
    case "dialEnergy": {
      // GOLD. The dial has left the ladder of clocks for the one reading
      // that is not a rate, so it does not get the next rung of the wood
      // tap. It gets a small GLOW: the solve shimmer's pad, low and quiet,
      // drifting up a major third and gone in under half a second, with a
      // breath of air under it. No sparkle on top - the high notes tried
      // here (a coin, a lone bell) all pierced - and no strike anywhere;
      // it arrives and fades. Half the solve shimmer's level.
      shimmerPad(ctx, out, { from: 330, to: 415, duration: 0.42, peak: 0.07 });
      puff(ctx, out, { frequency: 2400, q: 0.5, duration: 0.25, peak: 0.02, delay: 0.05 });
      break;
    }
    case "dialPower": {
      // The voltage ladder audibly CLIMBING, in the ZAP's spark material.
      // The BITE carries the reading: a whole 1.16 ratio per rung (nearly
      // a major second - adjacent tiers at 1.11 under the noise were
      // indistinguishable, which read as one sound repeating), louder than
      // the sparks, which stay for texture. Fractional rungs are real:
      // supply steps climb in quarter-rungs inside their tier.
      const rung = Math.max(0, Math.min(16, step));
      const bite = 175 * Math.pow(1.16, rung);
      blip(ctx, out, {
        from: bite,
        to: bite * 1.12,
        duration: 0.09,
        peak: 0.18 + rung * 0.004,
      });
      puff(ctx, out, {
        frequency: 1800 + rung * 150,
        q: 6,
        duration: 0.03,
        peak: 0.08 + rung * 0.004,
        delay: 0.01,
      });
      puff(ctx, out, {
        frequency: 1300 + rung * 120,
        q: 5,
        duration: 0.035,
        peak: 0.05 + rung * 0.003,
        delay: 0.04,
      });
      break;
    }
    case "place":
      // One FLAT rounded thump with a knock: a card set down. No pitch
      // fall at all - any downward movement here read as the delete
      // family, however shallow.
      blip(ctx, out, { from: 196, to: 196, duration: 0.2, peak: 0.44 });
      puff(ctx, out, { frequency: 1400, duration: 0.05, peak: 0.18 });
      break;
    case "placeProduct":
      // Two discrete taps stepping UP a fourth. The first assignment had
      // this pair the other way round and the down-step read as failure;
      // Jack's call: product rises, source settles.
      blip(ctx, out, { from: 147, to: 147, duration: 0.14, peak: 0.36 });
      blip(ctx, out, { from: 196, to: 196, duration: 0.16, peak: 0.4, delay: 0.09 });
      puff(ctx, out, { frequency: 1400, duration: 0.05, peak: 0.16 });
      break;
    case "placeSource":
      // ONE flat tap, a shade above the machine thump. The knock-knock
      // pair kept reading wrong (and a burst could steal its second knock,
      // so the same action sounded different run to run); the single beat
      // is what survived the ear test. Down-motion stays reserved for
      // delete.
      blip(ctx, out, { from: 185, to: 185, duration: 0.16, peak: 0.4 });
      puff(ctx, out, { frequency: 1400, duration: 0.05, peak: 0.16 });
      break;
    case "delete":
      // A small settling step down - removed, not mourned. The octave
      // plunge this used to be made every cleanup sound like a loss.
      blip(ctx, out, { from: 311, to: 233, duration: 0.18, peak: 0.34 });
      break;
    case "connect":
      // A click and a settled tone one step up: latched, not celebrated.
      // The old wide-interval chime read as a fanfare.
      blip(ctx, out, { from: 523, to: 523, duration: 0.08, peak: 0.24 });
      blip(ctx, out, { from: 587, to: 587, duration: 0.14, peak: 0.26, delay: 0.06 });
      break;
    case "zap":
      // Electricity latching: three tiny bright sparks of narrow noise in
      // quick succession with a rising bite of tone under them - crackle,
      // not alarm. Pitch motion is UP (down stays reserved for delete).
      puff(ctx, out, { frequency: 2800, q: 6, duration: 0.03, peak: 0.22 });
      puff(ctx, out, { frequency: 3400, q: 6, duration: 0.025, peak: 0.16, delay: 0.035 });
      puff(ctx, out, { frequency: 2300, q: 5, duration: 0.035, peak: 0.14, delay: 0.065 });
      blip(ctx, out, { from: 740, to: 988, duration: 0.1, peak: 0.18, delay: 0.015 });
      break;
    case "zapOff":
      // The zap's complement: the same crackle material DISCHARGING - the
      // sparks step down in brightness and the bite falls (down-motion is
      // the delete family's, and this is a delete).
      puff(ctx, out, { frequency: 3200, q: 6, duration: 0.03, peak: 0.18 });
      puff(ctx, out, { frequency: 2300, q: 6, duration: 0.03, peak: 0.14, delay: 0.035 });
      puff(ctx, out, { frequency: 1500, q: 5, duration: 0.045, peak: 0.12, delay: 0.07 });
      blip(ctx, out, { from: 988, to: 659, duration: 0.11, peak: 0.16, delay: 0.015 });
      break;
    case "snap":
      // A quick grab: the scratch material but snappier - a short brush
      // with a small tick of tone, pitched mid rather than high. Fires on
      // the TRANSITION into a snap, never per frame.
      puff(ctx, out, { frequency: 1300, q: 1.4, duration: 0.045, peak: 0.22 });
      blip(ctx, out, { from: 523, to: 523, duration: 0.04, peak: 0.1, delay: 0.01 });
      break;
    case "unwire":
      // One falling note, softer than delete: only a wire went.
      blip(ctx, out, { from: 440, to: 330, duration: 0.16, peak: 0.28 });
      break;
    case "error":
      // Not a buzzer: a soft SCRATCH of noise, "nothing happened". Two
      // little brushes, no tone at all - a dead wire drag should feel like
      // paper, not like an alarm.
      puff(ctx, out, { frequency: 900, q: 1.2, duration: 0.06, peak: 0.2 });
      puff(ctx, out, { frequency: 550, q: 1, duration: 0.1, peak: 0.18, delay: 0.05 });
      break;
    case "open":
      blip(ctx, out, { from: 262, to: 440, duration: 0.2, peak: 0.28 });
      break;
    case "close":
      blip(ctx, out, { from: 440, to: 262, duration: 0.2, peak: 0.28 });
      break;
    case "adjust":
      // A neutral mid tap: a knob turned, a pill cycled, a count stepped.
      blip(ctx, out, { from: 523, to: 523, duration: 0.08, peak: 0.2 });
      break;
    case "drawerOverflow":
      // A gate sliding free: mostly air, with a soft low body. No impact.
      puff(ctx, out, { frequency: 650, q: 0.7, duration: 0.22, peak: 0.17 });
      blip(ctx, out, { from: 220, to: 277, duration: 0.18, peak: 0.1, delay: 0.025 });
      break;
    case "drawerStrict":
      // One definite stop: a short wooden body and a crisp latch together.
      blip(ctx, out, { from: 294, to: 294, duration: 0.085, peak: 0.24 });
      puff(ctx, out, { frequency: 2300, q: 2.5, duration: 0.025, peak: 0.16 });
      break;
    case "drawerRatio":
      // A measured split: one tap followed by two lighter, separated taps.
      // Distinct rhythm as well as pitch; quiet enough to cycle repeatedly.
      blip(ctx, out, { from: 330, to: 330, duration: 0.06, peak: 0.17 });
      blip(ctx, out, { from: 440, to: 440, duration: 0.055, peak: 0.12, delay: 0.075 });
      blip(ctx, out, { from: 554, to: 554, duration: 0.07, peak: 0.1, delay: 0.15 });
      puff(ctx, out, { frequency: 1400, q: 1, duration: 0.04, peak: 0.055 });
      break;
    case "sweep":
      // One broad soft brush for a bulk change, however big it was.
      puff(ctx, out, { frequency: 700, q: 0.9, duration: 0.3, peak: 0.34 });
      blip(ctx, out, { from: 233, to: 311, duration: 0.28, peak: 0.2 });
      break;
    case "solveOn":
      // SOLVE: a relay engaging. A quick upward chirp with a click on it,
      // then one clean tick a beat later - short and dry like the latch
      // (build) and the plink (pool), so the three read as one family. The
      // old swelling pad is gone: it was the only long sound of the three.
      blip(ctx, out, { from: 1047, to: 1319, duration: 0.05, peak: 0.09 });
      puff(ctx, out, { frequency: 2400, q: 2, duration: 0.04, peak: 0.1 });
      blip(ctx, out, { from: 1568, to: 1568, duration: 0.06, peak: 0.06, delay: 0.09 });
      break;
    case "solveOff":
      // The same shimmer settling home: the pad glides back down the fifth
      // (the close family's motion, nothing like the delete step), sparkles
      // descending, the air a shade lower.
      shimmerPad(ctx, out, { from: 392, to: 262, duration: 0.55, peak: 0.22 });
      blip(ctx, out, { from: 1319, to: 1319, duration: 0.12, peak: 0.05, delay: 0.16 });
      blip(ctx, out, { from: 988, to: 988, duration: 0.14, peak: 0.045, delay: 0.3 });
      puff(ctx, out, { frequency: 2200, q: 0.6, duration: 0.3, peak: 0.05, delay: 0.05 });
      break;
    case "buildOn":
      // BUILD: a latch. A crisp high tick, then a wooden knock a beat
      // later - two distinct hits with a gap you can hear, the sound of a
      // catch closing, nothing like a brush or a pad. Nothing in it rises
      // or falls, so it is not a rung on the other two.
      blip(ctx, out, { from: 2200, to: 2200, duration: 0.03, peak: 0.1 });
      puff(ctx, out, { frequency: 3200, q: 3, duration: 0.03, peak: 0.08 });
      puff(ctx, out, { frequency: 320, q: 3, duration: 0.09, peak: 0.22, delay: 0.09 });
      blip(ctx, out, { from: 262, to: 262, duration: 0.07, peak: 0.1, delay: 0.09 });
      break;
    case "poolOn":
      // POOL: a drop into still water. One bright plink (a high sine that
      // bends UP, the way a droplet rings) and its echo a beat later, a
      // fifth down, over a short bright splash - all high and glassy,
      // nothing below middle C. Its own material, not a pad.
      blip(ctx, out, { from: 1568, to: 2093, duration: 0.09, peak: 0.09 });
      puff(ctx, out, { frequency: 4200, q: 1.2, duration: 0.07, peak: 0.07, delay: 0.01 });
      blip(ctx, out, { from: 1047, to: 1397, duration: 0.11, peak: 0.06, delay: 0.17 });
      puff(ctx, out, { frequency: 2600, q: 1.5, duration: 0.09, peak: 0.04, delay: 0.18 });
      break;
    case "poolOff":
      // Unused since the mode switch; the pool swell settling, kept so an
      // older caller still gets a sound.
      shimmerPad(ctx, out, { from: 175, to: 131, duration: 0.55, peak: 0.2 });
      puff(ctx, out, { frequency: 600, q: 0.5, duration: 0.4, peak: 0.06, delay: 0.04 });
      break;
    case "shuffle":
      // A card SLID onto the table: two brushes - a soft body and a lighter
      // trailing one - over a barely-there low tap for weight. No knock.
      puff(ctx, out, { frequency: 750, q: 0.8, duration: 0.09, peak: 0.24 });
      puff(ctx, out, { frequency: 1500, q: 1.6, duration: 0.05, peak: 0.1, delay: 0.035 });
      blip(ctx, out, { from: 165, to: 165, duration: 0.1, peak: 0.1, delay: 0.02 });
      break;
    case "shuffleWire":
      // The wire pass: a whisper of the connect click, mostly brush.
      puff(ctx, out, { frequency: 1900, q: 2, duration: 0.04, peak: 0.12 });
      blip(ctx, out, { from: 587, to: 587, duration: 0.06, peak: 0.08, delay: 0.015 });
      break;
    case "shuffleBoard":
      // A frame drawn around finished cards: one longer brush with a quiet
      // rise - the open sound's shape in the shuffle material.
      puff(ctx, out, { frequency: 600, q: 0.8, duration: 0.18, peak: 0.2 });
      blip(ctx, out, { from: 233, to: 294, duration: 0.16, peak: 0.1, delay: 0.02 });
      break;
    case "pageOpen":
      // A leaf lifted: one soft brush with a small rise under it, the open
      // sound's motion at a third of its voice.
      puff(ctx, out, { frequency: 900, q: 0.9, duration: 0.12, peak: 0.14 });
      blip(ctx, out, { from: 392, to: 494, duration: 0.12, peak: 0.08, delay: 0.01 });
      break;
    case "pageClose":
      // The leaf laid down: the same brush a shade lower, settling (the
      // close family's glide, nothing like the delete step).
      puff(ctx, out, { frequency: 700, q: 0.9, duration: 0.12, peak: 0.12 });
      blip(ctx, out, { from: 494, to: 392, duration: 0.12, peak: 0.08, delay: 0.01 });
      break;
    case "pageTurn":
      // A page turned: two quick brushes, the second lighter, over a
      // barely-there flat tick. No pitch motion - a turn is neither an
      // arrival nor a loss.
      puff(ctx, out, { frequency: 1100, q: 1.2, duration: 0.07, peak: 0.12 });
      puff(ctx, out, { frequency: 1600, q: 1.6, duration: 0.04, peak: 0.06, delay: 0.03 });
      blip(ctx, out, { from: 587, to: 587, duration: 0.05, peak: 0.06, delay: 0.01 });
      break;
    case "checklistOn":
      puff(ctx, out, { frequency: 1200, q: 1.3, duration: 0.08, peak: 0.12 });
      blip(ctx, out, { from: 740, to: 880, duration: 0.08, peak: 0.09, delay: 0.04 });
      break;
    case "checklistOff":
      puff(ctx, out, { frequency: 650, q: 0.8, duration: 0.1, peak: 0.1 });
      blip(ctx, out, { from: 440, to: 370, duration: 0.07, peak: 0.07 });
      break;
    case "checklistCheck":
      // Two pencil strokes, then a soft tap.
      puff(ctx, out, { frequency: 1800, q: 1.2, duration: 0.035, peak: 0.14 });
      puff(ctx, out, { frequency: 2400, q: 1.1, duration: 0.075, peak: 0.1, delay: 0.03 });
      blip(ctx, out, { from: 880, to: 880, duration: 0.045, peak: 0.065, delay: 0.07 });
      break;
    case "checklistRestore":
      // An eraser rub, softer and lower than the pencil.
      puff(ctx, out, { frequency: 800, q: 0.7, duration: 0.1, peak: 0.13 });
      puff(ctx, out, { frequency: 600, q: 0.8, duration: 0.06, peak: 0.07, delay: 0.055 });
      break;
    case "tick":
      // A switch thrown: the adjust tap's little sibling, half its voice,
      // with a grain of air so it reads as a key and not a note.
      blip(ctx, out, { from: 659, to: 659, duration: 0.05, peak: 0.09 });
      puff(ctx, out, { frequency: 2000, q: 3, duration: 0.02, peak: 0.04 });
      break;
    case "stencilAdd":
      // A condition joins: one small step up.
      blip(ctx, out, { from: 523, to: 587, duration: 0.09, peak: 0.12 });
      break;
    case "stencilRemove":
      // And leaves: the same step back down - a removal, so down is right.
      blip(ctx, out, { from: 587, to: 523, duration: 0.09, peak: 0.1 });
      break;
    case "shelfTurn":
      // A card slid along the shelf: brush only, no tone at all (Jack: the
      // tone read as a beep). One low soft brush and a fainter one trailing.
      puff(ctx, out, { frequency: 480, q: 0.7, duration: 0.11, peak: 0.07 });
      puff(ctx, out, { frequency: 360, q: 0.9, duration: 0.07, peak: 0.03, delay: 0.05 });
      break;
    case "shelfTick":
      // A filter changed: the same brush, shorter and smaller. Air only.
      puff(ctx, out, { frequency: 560, q: 0.9, duration: 0.06, peak: 0.05 });
      break;
  }
}

/**
 * Builds and resumes the context ahead of the first real sound, so it never
 * plays into a cold output stream. Call from any early user gesture.
 */
export function primeBoardSounds(): void {
  if (typeof window === "undefined" || !areBoardSoundsEnabled()) {
    return;
  }
  const ctx = getContext();
  if (ctx && ctx.state !== "running") {
    void ctx.resume().catch(() => {});
  }
}

export function playBoardSound(
  kind: BoardSoundKind,
  options?: {
    /**
     * Scales this one sound against the master volume (the timelapse's own
     * dial rides here). Above 1 is allowed - the soft-clip roof rounds off
     * anything pushed too far - but the voices are tuned for 1.
     */
    gain?: number;
    /** The dial voices' rung: which choice was picked, 0 upward. */
    step?: number;
  },
): void {
  if (typeof window === "undefined" || !areBoardSoundsEnabled()) {
    return;
  }
  if (typeof document !== "undefined" && document.hidden) {
    return;
  }
  const now = performance.now();
  if (now < quietUntil) {
    return;
  }
  if (now < (kindQuietUntil.get(kind) ?? 0)) {
    return;
  }
  const last = lastPlayedAt.get(kind);
  if (last !== undefined && now - last < DEDUPE_MS) {
    return;
  }
  const streak =
    last !== undefined && now - last < REPEAT_WINDOW_MS ? (repeatStreak.get(kind) ?? 0) + 1 : 0;
  repeatStreak.set(kind, streak);
  lastPlayedAt.set(kind, now);
  const duck = Math.pow(REPEAT_DUCK, Math.min(streak, REPEAT_DUCK_FLOOR));

  const ctx = getContext();
  const out = masterGain;
  if (!ctx || !out) {
    return;
  }
  const play = () => {
    // Steal, don't stack: fade any live voice of this kind out fast.
    const previous = activeVoices.get(kind);
    if (previous) {
      const t = ctx.currentTime;
      previous.gain.setValueAtTime(previous.gain.value, t);
      previous.gain.linearRampToValueAtTime(0.0001, t + STEAL_FADE);
    }
    // One gain node PER SOUND, so the whole sound (all its notes and
    // puffs) can be stolen as a unit by the next retrigger.
    const voice = ctx.createGain();
    voice.gain.value = duck * (options?.gain ?? 1);
    voice.connect(out);
    activeVoices.set(kind, voice);
    schedule(kind, ctx, voice, options?.step ?? 0);
    window.setTimeout(() => {
      if (activeVoices.get(kind) === voice) {
        activeVoices.delete(kind);
      }
      voice.disconnect();
    }, 1000);
  };
  if (ctx.state !== "running") {
    // Never schedule against a suspended clock: resume first, play in the
    // callback. Sounds fire from user gestures, so the resume succeeds.
    void ctx.resume().then(play).catch(() => {});
    return;
  }
  if (DEFERS_GRAPH_COMMANDS_TO_TASK_END) {
    // A task of its own, so nothing the caller does after asking - a solve,
    // a render - stands between the note and the audio thread (header).
    window.setTimeout(play, 0);
    return;
  }
  play();
}
