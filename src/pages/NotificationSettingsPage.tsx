import React, { useState } from 'react';
import {
  Volume2,
  VolumeX,
  Bell,
  Play,
  CheckCircle2,
  ShieldAlert,
} from 'lucide-react';
import { useStore } from '../context/StoreContext';
import {
  audioNotifier,
  type TelegramTone,
  type ViberTone,
} from '../lib/audioNotifier';

export const NotificationSettingsPage: React.FC = () => {
  const { settings, customers, audioUnlocked, unlockAudio, saveSettings } = useStore();
  const [browserPerm, setBrowserPerm] = useState<string>(() =>
    typeof window !== 'undefined' && 'Notification' in window
      ? Notification.permission
      : 'unsupported'
  );
  const [savedNotice, setSavedNotice] = useState<string | null>(null);

  const totalUnread = customers.reduce((sum, c) => sum + (c.unreadCount || 0), 0);

  const handleEnableAudio = async () => {
    const ok = await unlockAudio();
    if (ok) {
      await audioNotifier.playNotification(
        'telegram',
        settings.volume,
        settings.telegramTone
      );
      setSavedNotice('Browser audio unlocked and ready for live alerts.');
    }
  };

  const handleTestSound = async (platform: 'viber' | 'telegram') => {
    await unlockAudio();
    const tone = platform === 'viber' ? settings.viberTone : settings.telegramTone;
    const ok = await audioNotifier.playNotification(platform, settings.volume, tone);
    if (!ok) {
      setSavedNotice('Click "Enable Sound" first so your browser allows audio playback.');
    }
  };

  const handleToggleBrowserNotify = async () => {
    if (!settings.browserNotificationsEnabled) {
      const perm = await audioNotifier.requestBrowserPermission();
      setBrowserPerm(perm);
      if (perm === 'granted') {
        await saveSettings({ browserNotificationsEnabled: true });
        await audioNotifier.sendBrowserNotification(
          'FOREVER BOT',
          'Browser notifications are now active for incoming Viber and Telegram messages.'
        );
      } else {
        setSavedNotice(`Browser permission state: ${perm}`);
      }
    } else {
      await saveSettings({ browserNotificationsEnabled: false });
    }
  };

  return (
    <div className="max-w-4xl space-y-6">
      <div className="rounded-2xl border border-[#D4AF37]/25 bg-[#140A0D] p-6 space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-white/10 pb-4">
          <div>
            <h2 className="font-display text-lg font-semibold text-[#FAF7F2]">
              Audio & Unread Notification Settings
            </h2>
            <p className="text-xs text-[#9C8B86] mt-0.5 tabular-nums">
              Current unread messages across all bots: <strong className="text-[#FDE68A]">{totalUnread}</strong>
            </p>
          </div>

          <button
            type="button"
            onClick={handleEnableAudio}
            className={`inline-flex items-center gap-2 rounded-lg px-4 py-2 text-xs font-semibold cursor-pointer transition ${
              audioUnlocked
                ? 'border border-emerald-500/40 bg-emerald-950/40 text-emerald-300'
                : 'bg-gradient-to-r from-[#991B1B] to-[#D97706] text-white hover:brightness-110'
            }`}
          >
            <Volume2 className="w-4 h-4" />
            {audioUnlocked ? 'Audio Engine Unlocked' : 'Enable Sound'}
          </button>
        </div>

        {!audioUnlocked && (
          <div className="rounded-lg border border-amber-500/40 bg-amber-950/30 px-4 py-3 text-xs text-amber-200 flex items-center gap-2">
            <ShieldAlert className="w-4 h-4 shrink-0" />
            <span>
              Modern browsers restrict autoplay until you interact with the page. Click <strong>Enable Sound</strong> above to guarantee loud audio alerts when new customer messages arrive.
            </span>
          </div>
        )}

        {savedNotice && (
          <div className="rounded-lg border border-emerald-500/40 bg-emerald-950/40 px-4 py-2.5 text-xs text-emerald-200 flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 shrink-0" />
            <span>{savedNotice}</span>
          </div>
        )}

        {/* Master Enable & Volume */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
          <div className="rounded-xl border border-white/10 bg-[#0B0608] p-4 flex items-center justify-between">
            <div className="flex items-center gap-3">
              {settings.soundEnabled ? (
                <Volume2 className="w-5 h-5 text-[#FDE68A]" />
              ) : (
                <VolumeX className="w-5 h-5 text-[#9C8B86]" />
              )}
              <div>
                <p className="text-sm font-medium text-[#FAF7F2]">Sound Alerts</p>
                <p className="text-xs text-[#9C8B86]">Play loud alert on incoming messages</p>
              </div>
            </div>
            <input
              type="checkbox"
              checked={settings.soundEnabled}
              onChange={(e) => saveSettings({ soundEnabled: e.target.checked })}
              className="w-4 h-4 accent-[#D4AF37] cursor-pointer"
            />
          </div>

          <div className="rounded-xl border border-white/10 bg-[#0B0608] p-4 space-y-2">
            <div className="flex items-center justify-between text-xs">
              <span className="font-medium text-[#FAF7F2]">Master Volume</span>
              <span className="font-mono text-[#FDE68A] tabular-nums">{settings.volume}%</span>
            </div>
            <input
              type="range"
              min={0}
              max={100}
              value={settings.volume}
              onChange={(e) => saveSettings({ volume: Number(e.target.value) })}
              className="w-full accent-[#D4AF37] cursor-pointer"
            />
          </div>
        </div>

        {/* Platform-Specific Sounds */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-2">
          <div className="rounded-xl border border-[#D4AF37]/25 bg-[#0B0608] p-5 space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="font-display text-sm font-semibold text-[#FAF7F2]">
                Viber Notification Sound
              </h3>
              <button
                type="button"
                onClick={() => handleTestSound('viber')}
                className="inline-flex items-center gap-1.5 rounded-lg border border-[#D4AF37]/40 px-3 py-1.5 text-xs font-medium text-[#FDE68A] hover:bg-white/5 cursor-pointer"
              >
                <Play className="w-3.5 h-3.5" />
                Test Viber Sound
              </button>
            </div>
            <select
              value={settings.viberTone}
              onChange={(e) => saveSettings({ viberTone: e.target.value as ViberTone })}
              className="w-full rounded-lg border border-white/10 bg-[#140A0D] px-3 py-2 text-xs text-white"
            >
              <option value="royal_chime">Royal Chime (Bright Ascending Triad)</option>
              <option value="crimson_bell">Crimson Bell (Resonant Double Bell)</option>
              <option value="crystal_ping">Crystal Ping (High Octave Alert)</option>
            </select>
          </div>

          <div className="rounded-xl border border-[#D4AF37]/25 bg-[#0B0608] p-5 space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="font-display text-sm font-semibold text-[#FAF7F2]">
                Telegram Notification Sound
              </h3>
              <button
                type="button"
                onClick={() => handleTestSound('telegram')}
                className="inline-flex items-center gap-1.5 rounded-lg border border-[#D4AF37]/40 px-3 py-1.5 text-xs font-medium text-[#FDE68A] hover:bg-white/5 cursor-pointer"
              >
                <Play className="w-3.5 h-3.5" />
                Test Telegram Sound
              </button>
            </div>
            <select
              value={settings.telegramTone}
              onChange={(e) => saveSettings({ telegramTone: e.target.value as TelegramTone })}
              className="w-full rounded-lg border border-white/10 bg-[#140A0D] px-3 py-2 text-xs text-white"
            >
              <option value="gold_pulse">Gold Pulse (Crisp Dual-Tone Arpeggio)</option>
              <option value="velvet_chord">Velvet Chord (Rich 3-Note Alert)</option>
              <option value="sharp_alert">Sharp Alert (Urgent Triple Signal)</option>
            </select>
          </div>
        </div>

        {/* Browser Desktop Notifications */}
        <div className="rounded-xl border border-white/10 bg-[#0B0608] p-4 flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <Bell className="w-5 h-5 text-[#D4AF37]" />
            <div>
              <p className="text-sm font-medium text-[#FAF7F2]">Browser Desktop Notifications</p>
              <p className="text-xs text-[#9C8B86]">
                Permission: <span className="font-mono text-[#C7B7B2]">{browserPerm}</span>
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={handleToggleBrowserNotify}
            className="rounded-lg border border-[#D4AF37]/40 px-4 py-2 text-xs font-medium text-[#FDE68A] hover:bg-white/5 cursor-pointer"
          >
            {settings.browserNotificationsEnabled
              ? 'Disable Browser Alerts'
              : 'Enable Browser Alerts'}
          </button>
        </div>
      </div>
    </div>
  );
};
