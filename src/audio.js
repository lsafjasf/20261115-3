// Web Audio 音效：警报、调度确认、控场、送达、胜利/失败，无外部资源
export function createAudioManager() {
  let ctx = null;
  let muted = false;

  function ensureContext() {
    if (!ctx) {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      ctx = new AudioCtx();
    }
    if (ctx.state === 'suspended') ctx.resume();
    return ctx;
  }

  function tone(frequency, duration, type = 'sine', gainValue = 0.08, when = 0) {
    if (muted) return;
    const audio = ensureContext();
    const oscillator = audio.createOscillator();
    const gain = audio.createGain();
    const start = audio.currentTime + when;
    oscillator.type = type;
    oscillator.frequency.setValueAtTime(frequency, start);
    gain.gain.setValueAtTime(0, start);
    gain.gain.linearRampToValueAtTime(gainValue, start + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
    oscillator.connect(gain).connect(audio.destination);
    oscillator.start(start);
    oscillator.stop(start + duration + 0.05);
  }

  function siren() {
    if (muted) return;
    const audio = ensureContext();
    const oscillator = audio.createOscillator();
    const gain = audio.createGain();
    const start = audio.currentTime;
    oscillator.type = 'sawtooth';
    gain.gain.setValueAtTime(0.06, start);
    for (let i = 0; i < 4; i += 1) {
      oscillator.frequency.setValueAtTime(620, start + i * 0.55);
      oscillator.frequency.linearRampToValueAtTime(880, start + i * 0.55 + 0.27);
      oscillator.frequency.setValueAtTime(620, start + i * 0.55 + 0.28);
    }
    gain.gain.exponentialRampToValueAtTime(0.0001, start + 2.2);
    oscillator.connect(gain).connect(audio.destination);
    oscillator.start(start);
    oscillator.stop(start + 2.3);
  }

  const sounds = {
    dispatch: () => tone(520, 0.18, 'triangle', 0.07),
    reroute: () => {
      tone(440, 0.12, 'triangle', 0.06);
      tone(660, 0.16, 'triangle', 0.06, 0.12);
    },
    control: () => {
      tone(587, 0.14, 'square', 0.05);
      tone(880, 0.2, 'square', 0.05, 0.14);
    },
    deliver: () => {
      tone(659, 0.12, 'sine', 0.08);
      tone(988, 0.22, 'sine', 0.08, 0.12);
    },
    warning: () => tone(220, 0.3, 'sawtooth', 0.06),
    death: () => tone(160, 0.6, 'sawtooth', 0.07),
    win: () => [523, 659, 784, 1047].forEach((f, i) => tone(f, 0.3, 'triangle', 0.09, i * 0.18)),
    fail: () => [392, 330, 262, 196].forEach((f, i) => tone(f, 0.35, 'sawtooth', 0.07, i * 0.22)),
    siren,
  };

  function play(kind) {
    if (muted || !sounds[kind]) return;
    try {
      sounds[kind]();
    } catch {
      // 浏览器自动播放策略未解锁时静默
    }
  }

  return {
    unlock: () => ensureContext(),
    play,
    toggleMute() {
      muted = !muted;
      return muted;
    },
    get muted() {
      return muted;
    },
  };
}
