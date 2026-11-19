import type { Platform } from '../types';

export type ViberTone = 'royal_chime' | 'crimson_bell' | 'crystal_ping';
export type TelegramTone = 'gold_pulse' | 'velvet_chord' | 'sharp_alert';

class AudioNotifier {
  private ctx: AudioContext | null = null;
  private unlocked = false;

  private getContext(): AudioContext | null {
    if (typeof window === 'undefined') return null;
    const AudioCtx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) return null;
    if (!this.ctx) {
      this.ctx = new AudioCtx();
    }
    return this.ctx;
  }

  async unlockAudio(): Promise<boolean> {
    const ctx = this.getContext();
    if (!ctx) return false;
    try {
      if (ctx.state === 'suspended') {
        await ctx.resume();
      }
      // Play silent impulse to guarantee Safari/Chrome unlock
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      gain.gain.value = 0.0001;
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 0.02);
      this.unlocked = ctx.state === 'running';
      return this.unlocked;
    } catch {
      return false;
    }
  }

  isUnlocked(): boolean {
    return this.unlocked && this.ctx?.state === 'running';
  }

  private scheduleNote(
    ctx: AudioContext,
    masterGain: GainNode,
    freq: number,
    startOffset: number,
    duration: number,
    type: OscillatorType = 'triangle',
    peak = 0.95
  ) {
    const now = ctx.currentTime + startOffset;
    const osc = ctx.createOscillator();
    const noteGain = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, now);

    noteGain.gain.setValueAtTime(0.001, now);
    noteGain.gain.exponentialRampToValueAtTime(peak, now + 0.015);
    noteGain.gain.exponentialRampToValueAtTime(0.001, now + duration);

    osc.connect(noteGain);
    noteGain.connect(masterGain);
    osc.start(now);
    osc.stop(now + duration + 0.02);
  }

  async playNotification(
    platform: Platform,
    volumePercent: number,
    tone?: ViberTone | TelegramTone
  ): Promise<boolean> {
    if (volumePercent <= 0) return true;
    const ctx = this.getContext();
    if (!ctx) return false;

    try {
      if (ctx.state === 'suspended') {
        await ctx.resume();
      }
      if (ctx.state !== 'running') {
        return false;
      }

      this.unlocked = true;

      // Compressor + Master Gain for loud, crisp, distortion-free sound
      const compressor = ctx.createDynamicsCompressor();
      compressor.threshold.setValueAtTime(-12, ctx.currentTime);
      compressor.ratio.setValueAtTime(6, ctx.currentTime);

      const masterGain = ctx.createGain();
      // Scale 0-100% aggressively so notifications are genuinely loud and noticeable
      const normalized = Math.min(Math.max(volumePercent / 100, 0), 1);
      masterGain.gain.setValueAtTime(normalized * 1.15, ctx.currentTime);

      masterGain.connect(compressor);
      compressor.connect(ctx.destination);

      if (platform === 'viber') {
        const selected = (tone as ViberTone) || 'royal_chime';
        if (selected === 'crimson_bell') {
          this.scheduleNote(ctx, masterGain, 784.0, 0, 0.22, 'sine', 1.0); // G5
          this.scheduleNote(ctx, masterGain, 1174.66, 0.14, 0.35, 'triangle', 1.0); // D6
          this.scheduleNote(ctx, masterGain, 1567.98, 0.28, 0.45, 'sine', 0.9); // G6
        } else if (selected === 'crystal_ping') {
          this.scheduleNote(ctx, masterGain, 987.77, 0, 0.18, 'sine', 1.0); // B5
          this.scheduleNote(ctx, masterGain, 1318.51, 0.12, 0.32, 'sine', 1.0); // E6
        } else {
          // royal_chime: distinct purple/viber-style double-bright chime
          this.scheduleNote(ctx, masterGain, 659.25, 0, 0.16, 'triangle', 0.95); // E5
          this.scheduleNote(ctx, masterGain, 830.61, 0.11, 0.18, 'triangle', 0.95); // G#5
          this.scheduleNote(ctx, masterGain, 987.77, 0.22, 0.38, 'sine', 1.0); // B5
          this.scheduleNote(ctx, masterGain, 1318.51, 0.22, 0.38, 'triangle', 0.7); // E6 harmonic
        }
      } else {
        const selected = (tone as TelegramTone) || 'gold_pulse';
        if (selected === 'velvet_chord') {
          this.scheduleNote(ctx, masterGain, 523.25, 0, 0.22, 'sine', 0.95); // C5
          this.scheduleNote(ctx, masterGain, 783.99, 0.13, 0.25, 'sine', 1.0); // G5
          this.scheduleNote(ctx, masterGain, 1046.5, 0.26, 0.38, 'triangle', 0.9); // C6
        } else if (selected === 'sharp_alert') {
          this.scheduleNote(ctx, masterGain, 1108.73, 0, 0.11, 'square', 0.55); // C#6
          this.scheduleNote(ctx, masterGain, 1479.98, 0.12, 0.14, 'square', 0.55); // F#6
          this.scheduleNote(ctx, masterGain, 1479.98, 0.28, 0.25, 'triangle', 0.95);
        } else {
          // gold_pulse: distinct crisp Telegram-style upward double ping
          this.scheduleNote(ctx, masterGain, 880.0, 0, 0.12, 'sine', 1.0); // A5
          this.scheduleNote(ctx, masterGain, 1174.66, 0.09, 0.14, 'sine', 1.0); // D6
          this.scheduleNote(ctx, masterGain, 1760.0, 0.18, 0.35, 'triangle', 0.95); // A6
        }
      }

      return true;
    } catch {
      return false;
    }
  }

  async sendBrowserNotification(title: string, body: string) {
    if (typeof window === 'undefined' || !('Notification' in window)) return;
    if (Notification.permission === 'granted') {
      try {
        new Notification(title, { body });
      } catch {
        // ignore in restricted iframe
      }
    }
  }

  async requestBrowserPermission(): Promise<NotificationPermission | 'unsupported'> {
    if (typeof window === 'undefined' || !('Notification' in window)) {
      return 'unsupported';
    }
    try {
      return await Notification.requestPermission();
    } catch {
      return Notification.permission;
    }
  }
}

export const audioNotifier = new AudioNotifier();
