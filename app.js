/* =========================================================================
 * Solfège Trainer
 * Generates random melodic phrases drawn from selected scale degrees within
 * a chosen vocal range, with playback (melody, first note, drone) via the
 * Web Audio API. Settings persist in localStorage.
 * ========================================================================= */

/* ---------- Music theory constants ---------- */
const NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
const MIDI_MIN = 35;   // B1
const MIDI_MAX = 84;   // C6
// Numeric (Nashville-style) labels mirror the solfège degrees so learners
// can map between movable-do and chord-tone numbering at a glance.
const SOLFEGE = [
  { label: "Do",  semitone: 0,  number: "1"  },
  { label: "Ra",  semitone: 1,  number: "b2" },
  { label: "Re",  semitone: 2,  number: "2"  },
  { label: "Me",  semitone: 3,  number: "b3" },
  { label: "Mi",  semitone: 4,  number: "3"  },
  { label: "Fa",  semitone: 5,  number: "4"  },
  { label: "Fi",  semitone: 6,  number: "#4" },
  { label: "Sol", semitone: 7,  number: "5"  },
  { label: "Le",  semitone: 8,  number: "b6" },
  { label: "La",  semitone: 9,  number: "6"  },
  { label: "Te",  semitone: 10, number: "b7" },
  { label: "Ti",  semitone: 11, number: "7"  },
];
const SCALES = {
  ionian:  [0, 2, 4, 5, 7, 9, 11],
  aeolian: [0, 2, 3, 5, 7, 8, 10],
};
// Order around the circle of fifths, clockwise starting at the top (Do).
const CIRCLE_OF_FIFTHS = [0, 7, 2, 9, 4, 11, 6, 1, 8, 3, 10, 5];

/* ---------- Pure helpers ---------- */
const num = v => Number(v);
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const pick = arr => arr[Math.floor(Math.random() * arr.length)];
const midiToFreq = midi => 440 * Math.pow(2, (midi - 69) / 12);
function midiToName(midi) { return `${NOTE_NAMES[midi % 12]}${Math.floor(midi / 12) - 1}`; }
function nameToMidi(name) {
  const m = name.match(/^([A-G]#?)(-?\d+)$/);
  return m ? (num(m[2]) + 1) * 12 + NOTE_NAMES.indexOf(m[1]) : null;
}
function degreeClass(label) { return `deg-${label.toLowerCase()}`; }
function subscriptOctave(name) { return name.replace(/(-?\d+)/, "<sub>$1</sub>"); }
function arrowBetween(a, b) {
  const dir = b > a ? "↑" : "↓";
  const distance = Math.abs(b-a);
  if (distance <= 12) {
    return dir;
  }
  return dir.repeat(Math.floor(distance / 12) + 1);
}

/* ---------- Persistence ---------- */
const STORAGE_KEY = "ear-training.settings.v1";
const DEFAULTS = {
  key: "E",
  numNotes: 4,
  bpm: 100,
  volume: 80,
  droneVolume: 65,
  // Default vocal range: a comfortable amateur span that fits both
  // common male (low) and female (high) voices — G2 to G4 (~2 octaves).
  rangeLow: nameToMidi("G2"),
  rangeHigh: nameToMidi("G4"),
  selectedSemitones: SCALES.ionian,
};

function loadSettings() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? { ...DEFAULTS, ...JSON.parse(raw) } : { ...DEFAULTS };
  } catch {
    return { ...DEFAULTS };
  }
}
function saveSettings() {
  const data = {
    key: state.keyPc,
    numNotes: state.numNotes,
    bpm: num(el.bpm.value),
    volume: num(el.volume.value),
    droneVolume: num(el.droneVolume.value),
    rangeLow: num(el.rangeLow.value),
    rangeHigh: num(el.rangeHigh.value),
    selectedSemitones: getSelectedSemitones(),
  };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
}

/* ---------- DOM references ---------- */
const el = {
  keySegmented:      document.getElementById("keySegmented"),
  numNotesSegmented: document.getElementById("numNotesSegmented"),
  rangeLow:          document.getElementById("rangeLow"),
  rangeHigh:         document.getElementById("rangeHigh"),
  rangeLowLabel:     document.getElementById("rangeLowLabel"),
  rangeHighLabel:    document.getElementById("rangeHighLabel"),
  rangeTrack:        document.getElementById("rangeTrack"),
  degrees:           document.getElementById("degrees"),
  setIonian:         document.getElementById("setIonian"),
  setAeolian:        document.getElementById("setAeolian"),
  melody:            document.getElementById("melody"),
  status:            document.getElementById("status"),
  generate:          document.getElementById("generate"),
  playMelody:        document.getElementById("playMelody"),
  playTonic:         document.getElementById("playTonic"),
  toggleDrone:       document.getElementById("toggleDrone"),
  bpm:               document.getElementById("bpm"),
  bpmLabel:          document.getElementById("bpmLabel"),
  volume:            document.getElementById("volume"),
  volumeLabel:       document.getElementById("volumeLabel"),
  droneVolume:       document.getElementById("droneVolume"),
  droneVolumeLabel:  document.getElementById("droneVolumeLabel"),
};

/* ---------- App state ---------- */
const state = {
  keyPc: 0,            // 0–11 pitch class (tonic)
  numNotes: 4,
  tonicMidi: null,
  melody: [],          // array of MIDI numbers (includes leading tonic)
  drone: null,         // { masterGain, oscillators, midi } when running
  playback: null,      // { timers: [], oscillators: [], endTimer } when active
};

/* ---------- Icons (Lucide, ISC license) ---------- */
const ICONS = {
  sun:    `<svg class="icon" aria-hidden="true" focusable="false" viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"/></svg>`,
  moon:   `<svg class="icon" aria-hidden="true" focusable="false" viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>`,
  dice:   `<svg class="icon" aria-hidden="true" focusable="false" viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="8" cy="8" r="1" fill="currentColor"/><circle cx="16" cy="8" r="1" fill="currentColor"/><circle cx="12" cy="12" r="1" fill="currentColor"/><circle cx="8" cy="16" r="1" fill="currentColor"/><circle cx="16" cy="16" r="1" fill="currentColor"/></svg>`,
  play:   `<svg class="icon" aria-hidden="true" focusable="false" viewBox="0 0 24 24" fill="currentColor" stroke="none"><path d="M8 5v14l11-7z"/></svg>`,
  stop:   `<svg class="icon" aria-hidden="true" focusable="false" viewBox="0 0 24 24" fill="currentColor" stroke="none"><rect x="6" y="6" width="12" height="12" rx="1.5"/></svg>`,
  note:   `<svg class="icon" aria-hidden="true" focusable="false" viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3" fill="currentColor"/><circle cx="18" cy="16" r="3" fill="currentColor"/></svg>`,
  wave:   `<svg class="icon" aria-hidden="true" focusable="false" viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12c2 0 2-6 4-6s2 12 4 12 2-12 4-12 2 12 4 12 2-6 4-6"/></svg>`,
  mute:   `<svg class="icon" aria-hidden="true" focusable="false" viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12c2 0 2-3 4-3s2 6 4 6 2-6 4-6 2 3 4 3"/><path d="M16 4l6 6M22 4l-6 6"/></svg>`,
};

/* ---------- Audio: shared context ----------
 * A single AudioContext is reused for the lifetime of the page. Browsers
 * (especially iOS Safari) require the context to be resumed inside a user
 * gesture; getAudio() handles that lazily.
 */
let audioCtx = null;
function getAudio() {
  if (!audioCtx) {
    const Ctor = window.AudioContext || window.webkitAudioContext;
    audioCtx = new Ctor();
  }
  if (audioCtx.state === "suspended") audioCtx.resume();
  return audioCtx;
}

/* Play a single note (used as audible feedback while dragging the vocal
 * range thumbs, or tapping a note in the melody). Short, soft, and
 * self-cleaning. */
function playPreviewNote(midi, durationSec = 1.1) {
  const ctx = getAudio();
  const now = ctx.currentTime;
  const peak = 0.22 * clamp(num(el.volume.value) / 100, 0.1, 1);
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = "triangle";
  osc.frequency.value = midiToFreq(midi);
  const sustainEnd = Math.max(now + 0.05, now + durationSec - 0.25);
  gain.gain.setValueAtTime(0.0001, now);
  gain.gain.exponentialRampToValueAtTime(peak, now + 0.03);
  gain.gain.setValueAtTime(peak, sustainEnd);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + durationSec);
  osc.connect(gain).connect(ctx.destination);
  osc.start(now);
  osc.stop(now + durationSec + 0.02);
}

/* Start a sustained note that rings until releaseSustainedNote() is called.
 * Used by press-and-hold interactions on the degree picker and melody. */
function startSustainedNote(midi) {
  const ctx = getAudio();
  const now = ctx.currentTime;
  const peak = 0.22 * clamp(num(el.volume.value) / 100, 0.1, 1);
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = "triangle";
  osc.frequency.value = midiToFreq(midi);
  gain.gain.setValueAtTime(0.0001, now);
  gain.gain.exponentialRampToValueAtTime(peak, now + 0.03);
  osc.connect(gain).connect(ctx.destination);
  osc.start(now);
  return { osc, gain };
}
function releaseSustainedNote(handle) {
  if (!handle || !audioCtx) return;
  const { osc, gain } = handle;
  const now = audioCtx.currentTime;
  gain.gain.cancelScheduledValues(now);
  gain.gain.setValueAtTime(Math.max(0.0001, gain.gain.value), now);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.18);
  osc.stop(now + 0.22);
}

/* ---------- Audio: melody playback ----------
 * Schedules every note up-front via Web Audio for sample-accurate timing,
 * and uses setTimeout in lock-step to highlight the corresponding span in
 * the rendered melody.
 */
function stopPlayback() {
  if (!state.playback) return;
  const { timers, oscillators, endTimer } = state.playback;
  timers.forEach(clearTimeout);
  clearTimeout(endTimer);
  if (audioCtx) {
    const now = audioCtx.currentTime;
    oscillators.forEach(({ osc, gain }) => {
      gain.gain.cancelScheduledValues(now);
      gain.gain.setValueAtTime(Math.max(0.0001, gain.gain.value), now);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.05);
      osc.stop(now + 0.06);
    });
  }
  el.melody.querySelectorAll(".note.playing")
    .forEach(n => n.classList.remove("playing"));
  clearAllSounding();
  state.playback = null;
  updatePlayMelodyButton();
}

function playSequence(midis, beatSeconds, { highlight = false, track = false } = {}) {
  if (!midis.length) return;
  stopPlayback();

  const ctx = getAudio();
  const peak = 0.28 * clamp(num(el.volume.value) / 100, 0.1, 1);
  const gap = 0.04;
  const now = ctx.currentTime;
  const noteEls = highlight ? el.melody.querySelectorAll(".note") : null;
  const timers = [];
  const oscillators = [];
  let totalSec = 0;

  midis.forEach((midi, i) => {
    const offset = i * (beatSeconds + gap);
    const start = now + offset;
    const end = start + beatSeconds;
    const attack = Math.min(0.08, beatSeconds * 0.35);
    const release = Math.max(start + attack, end - Math.min(0.12, beatSeconds * 0.4));

    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "triangle";
    osc.frequency.value = midiToFreq(midi);
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(peak, start + attack);
    gain.gain.setValueAtTime(peak, release);
    gain.gain.exponentialRampToValueAtTime(0.0001, end);

    osc.connect(gain).connect(ctx.destination);
    osc.start(start);
    osc.stop(end + 0.02);
    oscillators.push({ osc, gain });
    totalSec = offset + beatSeconds;

    if (noteEls && noteEls[i]) {
      timers.push(
        setTimeout(() => noteEls[i].classList.add("playing"), offset * 1000),
        setTimeout(() => noteEls[i].classList.remove("playing"), (offset + beatSeconds) * 1000),
      );
    }
    // Mirror melody playback by lighting up the corresponding degree in
    // the picker.
    if (highlight && state.tonicMidi != null) {
      const semi = ((midi - state.tonicMidi) % 12 + 12) % 12;
      timers.push(
        setTimeout(() => addDegreeSounding(semi), offset * 1000),
        setTimeout(() => removeDegreeSounding(semi), (offset + beatSeconds) * 1000),
      );
    }
  });

  if (track) {
    const endTimer = setTimeout(() => { state.playback = null; updatePlayMelodyButton(); },
      totalSec * 1000 + 80);
    state.playback = { timers, oscillators, endTimer };
    updatePlayMelodyButton();
  }
}

function updatePlayMelodyButton() {
  const playing = !!state.playback;
  setIconLabel(el.playMelody, playing ? ICONS.stop : ICONS.play,
    playing ? "Stop" : "Play melody");
}

/* ---------- Audio: drone ----------
 * The drone is persistent: it only stops when the user explicitly toggles
 * it off. Generating a new melody or changing the tonic retunes the drone
 * without restarting the playback.
 */
function currentDroneGain() {
  return 0.16 * clamp(num(el.droneVolume.value) / 100, 0.1, 1);
}
function droneLayers(tonicMidi) {
  return [
    { type: "sine",     midi: tonicMidi - 24, gain: 0.30 },
    { type: "triangle", midi: tonicMidi - 12, gain: 0.72 },
    { type: "sine",     midi: tonicMidi,      gain: 0.24 },
  ];
}
function startDrone() {
  if (state.tonicMidi == null || state.drone) return;
  const ctx = getAudio();
  const now = ctx.currentTime;
  const masterGain = ctx.createGain();
  masterGain.gain.setValueAtTime(0.0001, now);
  masterGain.gain.exponentialRampToValueAtTime(currentDroneGain(), now + 0.55);

  const oscillators = droneLayers(state.tonicMidi).map(({ type, midi, gain }) => {
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = type;
    osc.frequency.value = midiToFreq(midi);
    g.gain.value = gain;
    osc.connect(g).connect(masterGain);
    osc.start(now);
    return osc;
  });
  masterGain.connect(ctx.destination);

  state.drone = { masterGain, oscillators, midi: state.tonicMidi };
  updateDroneButton();
}
function updateDroneButton() {
  const on = !!state.drone;
  setIconLabel(el.toggleDrone, on ? ICONS.mute : ICONS.wave,
    on ? "Stop drone" : "Drone");
}
function stopDrone() {
  if (!state.drone) return;
  const { masterGain, oscillators } = state.drone;
  const now = audioCtx.currentTime;
  masterGain.gain.cancelScheduledValues(now);
  masterGain.gain.setValueAtTime(Math.max(0.0001, masterGain.gain.value), now);
  masterGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.16);
  oscillators.forEach(osc => osc.stop(now + 0.2));
  state.drone = null;
  updateDroneButton();
}
function retuneDrone(tonicMidi) {
  if (!state.drone || state.drone.midi === tonicMidi) return;
  const now = audioCtx.currentTime;
  droneLayers(tonicMidi).forEach(({ midi }, i) => {
    const osc = state.drone.oscillators[i];
    osc.frequency.cancelScheduledValues(now);
    osc.frequency.setTargetAtTime(midiToFreq(midi), now, 0.04);
  });
  state.drone.midi = tonicMidi;
}

/* Pick a sensible MIDI for the current key & range — the pitch-class
 * occurrence closest to the middle of the vocal range. Used to set the
 * drone pitch (and a default tonic) when no melody has been generated yet,
 * or when the user changes the key while the drone is running. */
function tonicForKey(keyPc = state.keyPc) {
  const low  = num(el.rangeLow.value);
  const high = num(el.rangeHigh.value);
  const mid  = (low + high) / 2;
  let best = null, bestDist = Infinity;
  for (let m = low; m <= high; m++) {
    if (m % 12 !== keyPc) continue;
    const d = Math.abs(m - mid);
    if (d < bestDist) { best = m; bestDist = d; }
  }
  // Fallback: nearest pitch-class to mid even if outside range.
  if (best == null) {
    best = Math.round(mid / 12) * 12 + keyPc;
  }
  return best;
}

function syncTonicFromKey() {
  const t = tonicForKey();
  state.tonicMidi = t;
  retuneDrone(t);
  el.toggleDrone.disabled = false;
  el.playTonic.disabled = false;
}
function updateDroneVolume() {
  if (!state.drone) return;
  const now = audioCtx.currentTime;
  state.drone.masterGain.gain.cancelScheduledValues(now);
  state.drone.masterGain.gain.exponentialRampToValueAtTime(
    Math.max(0.0001, currentDroneGain()), now + 0.08);
}

/* ---------- Melody generation ---------- */
function getSelectedSemitones() {
  return [...el.degrees.querySelectorAll('.deg-dot[aria-pressed="true"]')]
    .map(n => num(n.dataset.semitone));
}
function getSelectedDegrees() {
  return [...el.degrees.querySelectorAll('.deg-dot[aria-pressed="true"]')]
    .map(n => ({ semitone: num(n.dataset.semitone), label: n.dataset.label }));
}
function pitchesForDegree(tonicMidi, semitone, low, high) {
  const out = [];
  for (let m = low; m <= high; m++) {
    if (((m - tonicMidi) % 12 + 12) % 12 === semitone) out.push(m);
  }
  return out;
}
function generateMelody() {
  const degrees = getSelectedDegrees();
  if (!degrees.length) return fail("Select at least one scale degree.");

  const noteCount = clamp(state.numNotes || DEFAULTS.numNotes, 1, 10);
  const low = num(el.rangeLow.value);
  const high = num(el.rangeHigh.value);
  const keyPc = state.keyPc;

  // Pick a tonic in range — deterministic so it matches the running drone.
  const tonicMidi = tonicForKey(keyPc);
  if (tonicMidi < low || tonicMidi > high) {
    return fail("No tonic in range for selected key.");
  }

  // Build melody. Each step is constrained to within 2 octaves of the
  // previous note, and we never repeat the previous pitch consecutively.
  const notes = [];
  let prev = tonicMidi;
  for (let i = 0; i < noteCount; i++) {
    const all = degrees.flatMap(d =>
      pitchesForDegree(tonicMidi, d.semitone, low, high)
        .filter(midi => Math.abs(midi - prev) <= 24)
        .map(midi => ({ midi, degree: d.label }))
    );
    if (!all.length) return fail("No valid notes with current constraints.");
    const nonRepeat = all.filter(c => c.midi !== prev);
    const note = pick(nonRepeat.length ? nonRepeat : all);
    notes.push(note);
    prev = note.midi;
  }

  state.tonicMidi = tonicMidi;
  state.melody = [tonicMidi, ...notes.map(n => n.midi)];
  retuneDrone(tonicMidi);
  renderMelody(tonicMidi, notes);
  setStatus("");
  setPlayable(true);
  saveSettings();

  function fail(msg) { setStatus(msg); setPlayable(false); }
}

/* ---------- Rendering ---------- */
function renderMelody(tonicMidi, notes) {
  // First note span corresponds to the tonic; remaining spans to each
  // generated note. Indexes line up with state.melody for highlighting.
  const parts = [
    `<span class="note tonic-note" role="button" tabindex="0" data-midi="${tonicMidi}">${subscriptOctave(midiToName(tonicMidi))}</span>`,
  ];
  let prev = tonicMidi;
  for (const { midi, degree } of notes) {
    parts.push(
      `<span class="interval" aria-hidden="true">${arrowBetween(prev, midi)}</span>` +
      `<span class="note ${degreeClass(degree)}" role="button" tabindex="0" data-midi="${midi}">${degree}</span>`
    );
    prev = midi;
  }
  el.melody.innerHTML = parts.join(" ");
  el.melody.classList.remove("placeholder");
}
function setStatus(msg) { el.status.textContent = msg; }
function setPlayable(enabled) {
  el.playMelody.disabled = !enabled;
  el.playTonic.disabled = state.tonicMidi == null;
  el.toggleDrone.disabled = state.tonicMidi == null;
}

/* ---------- Vocal range slider ---------- */
function syncRange() {
  const min = num(el.rangeLow.min);
  const max = num(el.rangeLow.max);
  let low = num(el.rangeLow.value);
  let high = num(el.rangeHigh.value);
  if (low > high) { [low, high] = [high, low]; el.rangeLow.value = low; el.rangeHigh.value = high; }

  const startPct = ((low - min) / (max - min)) * 100;
  const endPct   = ((high - min) / (max - min)) * 100;
  el.rangeTrack.style.setProperty("--range-start", `${startPct}%`);
  el.rangeTrack.style.setProperty("--range-end", `${endPct}%`);
  el.rangeLowLabel.textContent = midiToName(low);
  el.rangeHighLabel.textContent = midiToName(high);
  el.rangeLowLabel.style.left = `${startPct}%`;
  el.rangeHighLabel.style.left = `${endPct}%`;
}

/* ---------- Build form ---------- */
function buildSegmented(container, values, labelFor, current, onChange) {
  container.innerHTML = "";
  values.forEach(v => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.role = "radio";
    btn.dataset.value = String(v);
    btn.textContent = labelFor(v);
    btn.setAttribute("aria-checked", v === current ? "true" : "false");
    btn.addEventListener("click", () => onChange(v));
    container.appendChild(btn);
  });
}
function setSegmented(container, value) {
  container.querySelectorAll("button").forEach(b => {
    b.setAttribute("aria-checked", num(b.dataset.value) === value ? "true" : "false");
  });
}
function buildDegreeCircle(selected) {
  const set = new Set(selected);
  el.degrees.innerHTML = "";

  CIRCLE_OF_FIFTHS.forEach((semitone, i) => {
    const sol = SOLFEGE.find(s => s.semitone === semitone);
    const angle = (i / 12) * Math.PI * 2 - Math.PI / 2;
    const cos = Math.cos(angle), sin = Math.sin(angle);
    const dotR = 47, labelR = 33;
    const colorClass = degreeClass(sol.label);
    const pressed = set.has(semitone) ? "true" : "false";

    const dot = document.createElement("button");
    dot.type = "button";
    dot.className = `deg-dot ${colorClass}`;
    dot.style.left = `${50 + cos * dotR}%`;
    dot.style.top  = `${50 + sin * dotR}%`;
    dot.dataset.semitone = String(semitone);
    dot.dataset.label = sol.label;
    dot.setAttribute("aria-label", `${sol.label} (${sol.number})`);
    dot.setAttribute("aria-pressed", pressed);
    bindDegreeHold(dot, semitone);

    const lbl = document.createElement("button");
    lbl.type = "button";
    lbl.className = `deg-label ${colorClass}`;
    lbl.style.left = `${50 + cos * labelR}%`;
    lbl.style.top  = `${50 + sin * labelR}%`;
    lbl.dataset.semitone = String(semitone);
    lbl.innerHTML =
      `${sol.label}<sub class="deg-num" aria-hidden="true">${sol.number}</sub>`;
    lbl.tabIndex = -1;
    lbl.setAttribute("aria-hidden", "true");
    lbl.setAttribute("aria-pressed", pressed);
    bindDegreeHold(lbl, semitone);

    el.degrees.append(dot, lbl);
  });
}
function toggleDegree(semitone) {
  const nodes = el.degrees.querySelectorAll(`[data-semitone="${semitone}"]`);
  const next = nodes[0].getAttribute("aria-pressed") === "true" ? "false" : "true";
  nodes.forEach(n => n.setAttribute("aria-pressed", next));
  saveSettings();
}

/* Press-and-hold plays a sustained tone that rings until release. A short
 * tap on a degree picker still toggles its selection; a short tap on a
 * melody note plays a brief preview. Used by both the picker and the
 * generated melody.
 *
 *   getMidi():    callback returning the MIDI to sound (or null)
 *   onTap():      called for short clicks (under HOLD_MS)
 *   onHoldStart(midi): UI hook fired when the hold begins
 *   onHoldEnd():  UI hook fired when the held tone is released
 */
const HOLD_MS = 220;
function bindHoldToPlay(node, { getMidi, onTap, onHoldStart, onHoldEnd }) {
  let timer = null;
  let held = false;
  let handle = null;
  let activeMidi = null;

  const cancelTimer = () => { if (timer) { clearTimeout(timer); timer = null; } };
  const release = () => {
    cancelTimer();
    if (handle) { releaseSustainedNote(handle); handle = null; }
    if (held && onHoldEnd) onHoldEnd(activeMidi);
    activeMidi = null;
  };

  node.addEventListener("pointerdown", (e) => {
    if (e.button !== undefined && e.button !== 0) return;
    held = false;
    cancelTimer();
    try { node.setPointerCapture(e.pointerId); } catch {}
    timer = setTimeout(() => {
      held = true;
      timer = null;
      const midi = getMidi();
      if (midi == null) return;
      activeMidi = midi;
      handle = startSustainedNote(midi);
      if (onHoldStart) onHoldStart(midi);
    }, HOLD_MS);
  });
  // Note: do NOT reset `held` here — the click handler below uses it to
  // suppress the click that follows a long-press. It clears the flag itself.
  node.addEventListener("pointerup", () => release());
  node.addEventListener("pointercancel", () => { release(); held = false; });
  node.addEventListener("pointerleave", () => { if (held) release(); else cancelTimer(); });
  // Click fires after pointerup; suppress when it followed a hold so the
  // hold doesn't double-act as a tap.
  node.addEventListener("click", (e) => {
    if (held) { e.preventDefault(); e.stopImmediatePropagation(); held = false; return; }
    if (onTap) onTap(e);
  });
  node.addEventListener("contextmenu", (e) => e.preventDefault());
}

function bindDegreeHold(node, semitone) {
  bindHoldToPlay(node, {
    getMidi: () => midiForDegree(semitone),
    onTap:   () => toggleDegree(semitone),
    onHoldStart: () => addDegreeSounding(semitone),
    onHoldEnd:   () => removeDegreeSounding(semitone),
  });
}

/* Reference-counted .playing class on the picker so multiple sources
 * (melody playback + a held finger) don't fight each other. */
const soundingCounts = new Map();
function addDegreeSounding(semitone) {
  const n = (soundingCounts.get(semitone) || 0) + 1;
  soundingCounts.set(semitone, n);
  el.degrees.querySelectorAll(`[data-semitone="${semitone}"]`)
    .forEach(node => node.classList.add("playing"));
}
function removeDegreeSounding(semitone) {
  const n = (soundingCounts.get(semitone) || 0) - 1;
  if (n <= 0) {
    soundingCounts.delete(semitone);
    el.degrees.querySelectorAll(`[data-semitone="${semitone}"]`)
      .forEach(node => node.classList.remove("playing"));
  } else {
    soundingCounts.set(semitone, n);
  }
}
function clearAllSounding() {
  soundingCounts.clear();
  el.degrees.querySelectorAll(".playing").forEach(n => n.classList.remove("playing"));
}

/* Press-and-hold support for notes in the rendered melody.
 *
 * Re-rendering the melody replaces all .note nodes, so we use event
 * delegation on the container rather than per-note listeners. The hold
 * begins on whichever note received the pointerdown. */
function bindMelodyHold() {
  let timer = null;
  let held = false;
  let handle = null;
  let activeNote = null;
  let activeSemi = null;

  const cancelTimer = () => { if (timer) { clearTimeout(timer); timer = null; } };
  const release = () => {
    cancelTimer();
    if (handle) { releaseSustainedNote(handle); handle = null; }
    if (activeNote) activeNote.classList.remove("playing");
    if (activeSemi != null) removeDegreeSounding(activeSemi);
    activeNote = null; activeSemi = null;
  };

  el.melody.addEventListener("pointerdown", (e) => {
    if (e.button !== undefined && e.button !== 0) return;
    const target = e.target.closest(".note[data-midi]");
    if (!target) return;
    held = false;
    cancelTimer();
    try { target.setPointerCapture(e.pointerId); } catch {}
    timer = setTimeout(() => {
      held = true;
      timer = null;
      const midi = num(target.dataset.midi);
      handle = startSustainedNote(midi);
      activeNote = target;
      activeNote.classList.add("playing");
      if (state.tonicMidi != null) {
        activeSemi = ((midi - state.tonicMidi) % 12 + 12) % 12;
        addDegreeSounding(activeSemi);
      }
    }, HOLD_MS);
  });

  // `held` is intentionally not cleared on pointerup so the synthesised
  // click that follows can detect it and suppress the tap action.
  el.melody.addEventListener("pointerup", () => release());
  el.melody.addEventListener("pointercancel", () => { release(); held = false; });
  el.melody.addEventListener("pointerleave", () => { if (held) release(); });

  el.melody.addEventListener("click", (e) => {
    const target = e.target.closest(".note[data-midi]");
    if (!target) return;
    if (held) { e.preventDefault(); e.stopImmediatePropagation(); held = false; return; }
    const midi = num(target.dataset.midi);
    playPreviewNote(midi, 0.9);
    if (state.tonicMidi != null) {
      flashDegree(((midi - state.tonicMidi) % 12 + 12) % 12, 700);
    }
  });
  el.melody.addEventListener("contextmenu", (e) => {
    if (e.target.closest(".note[data-midi]")) e.preventDefault();
  });
}

/* Pick a sensible MIDI for a given scale degree (semitone offset from
 * tonic) within the current vocal range, preferring the occurrence
 * closest to the middle of the range. */
function midiForDegree(semitone) {
  if (state.tonicMidi == null) return null;
  const low = num(el.rangeLow.value);
  const high = num(el.rangeHigh.value);
  const mid = (low + high) / 2;
  const target = ((state.tonicMidi + semitone) % 12 + 12) % 12;
  let best = null, bestDist = Infinity;
  for (let m = low; m <= high; m++) {
    if (((m % 12) + 12) % 12 !== target) continue;
    const d = Math.abs(m - mid);
    if (d < bestDist) { best = m; bestDist = d; }
  }
  if (best == null) best = state.tonicMidi + semitone;
  return best;
}

/* Briefly highlight the dot+label for a given semitone in the picker. */
function flashDegree(semitone, ms = 220) {
  const nodes = el.degrees.querySelectorAll(`[data-semitone="${semitone}"]`);
  nodes.forEach(n => {
    n.classList.remove("flash");
    // Force reflow so the animation restarts on retrigger.
    void n.offsetWidth;
    n.classList.add("flash");
    n.style.setProperty("--flash-ms", `${ms}ms`);
  });
  clearTimeout(flashDegree._t?.[semitone]);
  flashDegree._t = flashDegree._t || {};
  flashDegree._t[semitone] = setTimeout(() => {
    nodes.forEach(n => n.classList.remove("flash"));
  }, ms + 50);
}
function applyScale(semitones) {
  const set = new Set(semitones);
  el.degrees.querySelectorAll("[data-semitone]").forEach(n => {
    n.setAttribute("aria-pressed", set.has(num(n.dataset.semitone)) ? "true" : "false");
  });
  saveSettings();
}

/* ---------- Helpers ---------- */
function setIconLabel(btn, iconSvg, text) {
  btn.innerHTML = `${iconSvg}<span>${text}</span>`;
}

/* ---------- Service worker (PWA) ---------- */
function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) return;
  if (location.protocol === "file:") return;
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("sw.js").catch(err => {
      console.warn("Service worker registration failed:", err);
    });
  });
}

/* ---------- Init ---------- */
function init() {
  registerServiceWorker();
  const s = loadSettings();

  buildDegreeCircle(s.selectedSemitones);

  el.rangeLow.min = el.rangeHigh.min = String(MIDI_MIN);
  el.rangeLow.max = el.rangeHigh.max = String(MIDI_MAX);

  // Key is now stored as a pitch-class index (0–11). Backwards-compat:
  // older saves used the note name string.
  const rawKey = typeof s.key === "string" ? NOTE_NAMES.indexOf(s.key) : num(s.key);
  state.keyPc    = clamp(rawKey >= 0 ? rawKey : 4, 0, 11);
  state.numNotes = clamp(num(s.numNotes), 1, 10);

  buildSegmented(el.keySegmented, [...Array(12).keys()], i => NOTE_NAMES[i],
    state.keyPc, v => {
      state.keyPc = v;
      setSegmented(el.keySegmented, v);
      syncTonicFromKey();
      saveSettings();
    });
  buildSegmented(el.numNotesSegmented, [...Array(10).keys()].map(i => i + 1),
    String, state.numNotes,
    v => { state.numNotes = v; setSegmented(el.numNotesSegmented, v); saveSettings(); });

  el.bpm.value      = String(clamp(num(s.bpm), 20, 300));
  el.volume.value   = String(clamp(num(s.volume), 10, 100));
  el.droneVolume.value = String(clamp(num(s.droneVolume), 10, 100));
  el.rangeLow.value  = String(clamp(num(s.rangeLow),  MIDI_MIN, MIDI_MAX));
  el.rangeHigh.value = String(clamp(num(s.rangeHigh), MIDI_MIN, MIDI_MAX));

  // Initial button content
  setIconLabel(el.generate, ICONS.dice, "Generate");
  updatePlayMelodyButton();
  setIconLabel(el.playTonic, ICONS.note, "First note");
  updateDroneButton();

  syncRange();
  syncSliderLabels();
  syncTonicFromKey();
  bindEvents();
}

function bindRangeSlider(input) {
  // While dragging we keep a single sustained voice and just retune it as
  // the user moves between pitches. This avoids the cluster of overlapping
  // notes (and accidental dissonance) that the previous fire-and-forget
  // preview produced.
  let lastPlayed = null;
  let handle = null;
  let releaseTimer = null;

  const stop = () => {
    if (handle) { releaseSustainedNote(handle); handle = null; }
    lastPlayed = null;
  };
  const scheduleStop = () => {
    clearTimeout(releaseTimer);
    releaseTimer = setTimeout(stop, 600);
  };

  input.addEventListener("input", () => {
    syncRange();
    saveSettings();
    const midi = num(input.value);
    if (midi === lastPlayed) return;
    lastPlayed = midi;
    if (!handle) {
      handle = startSustainedNote(midi);
    } else {
      const ctx = getAudio();
      handle.osc.frequency.setTargetAtTime(midiToFreq(midi), ctx.currentTime, 0.005);
    }
    scheduleStop();
  });

  // When the thumb is released, fade the preview out promptly.
  const release = () => { clearTimeout(releaseTimer); stop(); };
  input.addEventListener("change", release);
  input.addEventListener("pointerup", release);
  input.addEventListener("pointercancel", release);
  input.addEventListener("keyup", release);
  input.addEventListener("blur", release);
}

function syncSliderLabels() {
  el.bpmLabel.textContent         = `${num(el.bpm.value)} BPM`;
  el.volumeLabel.textContent      = `${num(el.volume.value)}%`;
  el.droneVolumeLabel.textContent = `${num(el.droneVolume.value)}%`;
}

function bindEvents() {
  // Range sliders
  // Vocal-range sliders: preview the note at the moved thumb. We throttle
  // to one preview per pitch change (so a long drag plays a small staircase
  // of pitches rather than a continuous chirp).
  bindRangeSlider(el.rangeLow);
  bindRangeSlider(el.rangeHigh);
  // Range changes can shift which octave best fits the current key.
  el.rangeLow.addEventListener("change", syncTonicFromKey);
  el.rangeHigh.addEventListener("change", syncTonicFromKey);

  // Form persistence
  el.bpm.addEventListener("input", () => { syncSliderLabels(); saveSettings(); });
  el.volume.addEventListener("input", () => { syncSliderLabels(); saveSettings(); });
  el.droneVolume.addEventListener("input", () => {
    syncSliderLabels();
    updateDroneVolume();
    saveSettings();
  });

  // Scale presets
  el.setIonian.addEventListener("click",  () => applyScale(SCALES.ionian));
  el.setAeolian.addEventListener("click", () => applyScale(SCALES.aeolian));

  // Click or press-and-hold a note in the rendered melody.
  bindMelodyHold();

  // Playback
  el.generate.addEventListener("click", () => { stopPlayback(); generateMelody(); });
  el.playMelody.addEventListener("click", () => {
    if (state.playback) { stopPlayback(); return; }
    playSequence(state.melody, 60 / Math.max(20, num(el.bpm.value)),
      { highlight: true, track: true });
  });
  el.playTonic.addEventListener("click", () => {
    playSequence([state.tonicMidi], 1.1);
    flashDegree(0, 900);
  });
  el.toggleDrone.addEventListener("click", () => state.drone ? stopDrone() : startDrone());

}

init();
