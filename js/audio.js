export const SOUND_EVENTS = {
  move: { freq: 420, duration: 0.025, type: "square" },
  rotate: { freq: 560, duration: 0.04, type: "sawtooth" },
  hardDrop: { freq: 190, duration: 0.055, type: "square" },
  line: { freq: 720, duration: 0.08, type: "triangle" },
  tetris: { freq: 880, duration: 0.14, type: "triangle" },
  combo: { freq: 960, duration: 0.09, type: "triangle" },
  levelUp: { freq: 1040, duration: 0.12, type: "triangle" },
  gameOver: { freq: 170, duration: 0.22, type: "sawtooth" },
  attack: { freq: 150, duration: 0.12, type: "sawtooth" }
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
