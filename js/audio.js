export const SOUND_EVENTS = {
  move: { freq: 420, duration: 0.025, type: "square", category: "move" },
  rotate: { freq: 560, duration: 0.04, type: "sawtooth", category: "rotate" },
  hardDrop: { freq: 190, duration: 0.055, type: "square", category: "drop" },
  hold: { freq: 330, duration: 0.05, type: "triangle", category: "ui" },
  line: { freq: 720, duration: 0.08, type: "triangle", category: "clear" },
  tetris: { freq: 880, duration: 0.14, type: "triangle", category: "clear" },
  combo: { freq: 960, duration: 0.09, type: "triangle", category: "clear" },
  levelUp: { freq: 1040, duration: 0.12, type: "triangle", category: "clear" },
  gameOver: { freq: 170, duration: 0.22, type: "sawtooth", category: "alert" },
  win: { freq: 980, duration: 0.22, type: "triangle", category: "alert" },
  attack: { freq: 150, duration: 0.12, type: "sawtooth", category: "alert" }
};

export function makeAudioSettings(overrides = {}) {
  return {
    sound: true,
    volume: 70,
    moveVolume: 55,
    clearVolume: 100,
    alertVolume: 90,
    ...overrides
  };
}

function soundLevelFor(settings, category) {
  if (category === "move" || category === "rotate" || category === "drop") return settings.moveVolume / 100;
  if (category === "clear") return settings.clearVolume / 100;
  if (category === "alert") return settings.alertVolume / 100;
  return Math.min(1.4, (settings.moveVolume + settings.alertVolume) / 200);
}

export function createWebAudioPlayer(settingsProvider, audioContextFactory = null) {
  let audioContext = null;

  function ensureAudio() {
    const settings = settingsProvider();
    if (!settings.sound || settings.volume <= 0) return null;
    const AudioClass = audioContextFactory || globalThis.AudioContext || globalThis.webkitAudioContext;
    if (!audioContext && AudioClass) audioContext = new AudioClass();
    if (audioContext?.state === "suspended") audioContext.resume();
    return audioContext;
  }

  function playTone({ freq, duration, type, category = "ui" }) {
    const settings = settingsProvider();
    const context = ensureAudio();
    if (!context) return;

    const now = context.currentTime;
    const oscillator = context.createOscillator();
    const filter = context.createBiquadFilter();
    const gain = context.createGain();
    const softType = type === "sawtooth" || type === "square" ? "triangle" : type;
    const categoryGain = {
      move: 0.55,
      rotate: 0.62,
      drop: 0.78,
      clear: 1.05,
      alert: 0.9,
      ui: 0.68
    }[category] || 0.68;

    oscillator.type = softType;
    oscillator.frequency.setValueAtTime(Math.max(110, freq * 0.82), now);
    filter.type = "lowpass";
    filter.frequency.setValueAtTime(category === "clear" ? 1900 : 1320, now);
    filter.Q.setValueAtTime(0.35, now);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(
      0.052 * categoryGain * soundLevelFor(settings, category) * (settings.volume / 100),
      now + 0.014
    );
    gain.gain.exponentialRampToValueAtTime(0.0001, now + Math.max(0.04, duration * 0.9));
    oscillator.connect(filter);
    filter.connect(gain);
    gain.connect(context.destination);
    oscillator.start(now);
    oscillator.stop(now + duration + 0.03);
  }

  function resume() {
    ensureAudio();
  }

  return { playTone, resume };
}

export function initAudio(settingsProvider, audioContextFactory = null) {
  const player = createWebAudioPlayer(settingsProvider, audioContextFactory);
  const controller = {
    muted: false,
    settingsProvider,
    player
  };
  return controller;
}

export function playSound(controller, eventOrFreq, duration, type, category = "ui") {
  if (!controller || controller.muted) return;

  if (typeof eventOrFreq === "string") {
    const event = SOUND_EVENTS[eventOrFreq];
    if (!event) return;
    controller.player.playTone({
      freq: event.freq,
      duration: event.duration,
      type: event.type,
      category: event.category
    });
    return;
  }

  controller.player.playTone({
    freq: eventOrFreq,
    duration,
    type,
    category
  });
}

export function setVolume(controller, nextVolume) {
  if (!controller) return;
  const settings = controller.settingsProvider();
  settings.volume = Math.max(0, Math.min(100, Number(nextVolume) || 0));
  settings.sound = settings.volume > 0;
}

export function toggleMute(controller, muted = !controller?.muted) {
  if (!controller) return false;
  controller.muted = Boolean(muted);
  return controller.muted;
}
