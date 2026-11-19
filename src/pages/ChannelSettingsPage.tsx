import React, { useState } from 'react';
import {
  Link2,
  Shield,
  RefreshCw,
  CheckCircle2,
  AlertCircle,
  Copy,
  Trash2,
  Plus,
} from 'lucide-react';
import { useStore } from '../context/StoreContext';
import { authFetch } from '../lib/apiClient';
import type { BotPermissions, BotRecord, Platform, SyncMode } from '../types';

export const ChannelSettingsPage: React.FC = () => {
  const { workspaceUid, bots, settings, upsertBot, deleteBot, logError } = useStore();

  const [selectedBotId, setSelectedBotId] = useState<string>('');
  const activeBot =
    bots.find((b) => b.id === selectedBotId) || bots[0] || null;

  const [tokenInput, setTokenInput] = useState('');
  const [webhookInput, setWebhookInput] = useState('');
  const [newChannelOpen, setNewChannelOpen] = useState(false);
  const [newName, setNewName] = useState('');
  const [newPlatform, setNewPlatform] = useState<Platform>('viber');
  const [newToken, setNewToken] = useState('');

  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [notice, setNotice] = useState<{ type: 'ok' | 'err'; text: string } | null>(
    null
  );

  const viberCount = bots.filter((b) => b.platform === 'viber').length;
  const telegramCount = bots.filter((b) => b.platform === 'telegram').length;

  const defaultWebhookFor = (bot: BotRecord) => {
    const base = (
      settings.defaultWebhookBaseUrl || window.location.origin
    ).replace(/\/+$/, '');
    return `${base}/api/webhooks/${bot.platform}/${bot.id}`;
  };

  const handleSelectBot = (bot: BotRecord) => {
    setSelectedBotId(bot.id);
    setTokenInput('');
    setWebhookInput(bot.webhookUrl || defaultWebhookFor(bot));
    setNotice(null);
  };

  const handleUpdateTokenAndTest = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeBot) return;
    setBusy(true);
    setNotice(null);
    try {
      const res = await authFetch('/api/bots/verify', {
        method: 'POST',
        body: JSON.stringify({
          botId: activeBot.id,
          name: activeBot.name,
          platform: activeBot.platform,
          token: tokenInput.trim() || undefined,
          encryptedToken: !tokenInput.trim() ? activeBot.encryptedToken : undefined,
          syncMode: activeBot.syncMode || (activeBot.platform === 'telegram' ? 'polling' : 'webhook'),
          webhookBaseUrl: settings.defaultWebhookBaseUrl || window.location.origin,
        }),
      });
      const json = (await res.json()) as {
        ok: boolean;
        encryptedToken?: string;
        tokenMasked?: string;
        botPlatformId?: string;
        botUsername?: string;
        webhookUrl?: string;
        webhookStatus?: BotRecord['webhookStatus'];
        syncMode?: SyncMode;
        lastSyncAt?: string;
        lastError?: string;
        error?: string;
      };
      if (!res.ok || !json.ok) {
        await upsertBot(
          { ...activeBot, status: 'error', lastError: json.error || 'Verification failed' },
          false
        );
        throw new Error(json.error || 'Channel verification failed');
      }

      await upsertBot(
        {
          ...activeBot,
          status: 'connected',
          encryptedToken: json.encryptedToken || activeBot.encryptedToken,
          tokenMasked: json.tokenMasked || activeBot.tokenMasked,
          botPlatformId: json.botPlatformId || activeBot.botPlatformId,
          botUsername: json.botUsername || activeBot.botUsername,
          webhookUrl: json.webhookUrl || activeBot.webhookUrl,
          webhookStatus: json.webhookStatus || activeBot.webhookStatus,
          syncMode: json.syncMode || activeBot.syncMode,
          lastSyncAt: json.lastSyncAt || new Date().toISOString(),
          lastError: json.lastError || '',
        },
        false
      );
      setTokenInput('');
      setNotice({ type: 'ok', text: 'Channel credentials verified and encrypted.' });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Verification error';
      setNotice({ type: 'err', text: msg });
      await logError(
        activeBot.platform === 'viber' ? 'viber_api' : 'telegram_api',
        `Channel test failed for ${activeBot.name}`,
        msg,
        activeBot.id
      );
    } finally {
      setBusy(false);
    }
  };

  const handleWebhookAction = async (action: 'set' | 'remove' | 'polling') => {
    if (!activeBot) return;
    setBusy(true);
    setNotice(null);
    const targetUrl = webhookInput.trim() || defaultWebhookFor(activeBot);
    try {
      const res = await authFetch(
        `/api/bots/${encodeURIComponent(activeBot.id)}/webhook`,
        {
          method: 'POST',
          body: JSON.stringify({
            action,
            platform: activeBot.platform,
            webhookUrl: targetUrl,
            encryptedToken: activeBot.encryptedToken,
          }),
        }
      );
      const json = (await res.json()) as {
        ok: boolean;
        webhookStatus?: BotRecord['webhookStatus'];
        webhookUrl?: string;
        error?: string;
      };
      if (!res.ok || !json.ok) {
        await upsertBot(
          {
            ...activeBot,
            webhookStatus: 'error',
            lastError: json.error || 'Webhook update failed',
          },
          false
        );
        throw new Error(json.error || 'Webhook configuration failed');
      }

      await upsertBot(
        {
          ...activeBot,
          syncMode: action === 'polling' ? 'polling' : 'webhook',
          webhookStatus: json.webhookStatus || 'active',
          webhookUrl: json.webhookUrl ?? targetUrl,
          lastError: '',
          lastSyncAt: new Date().toISOString(),
        },
        false
      );
      setNotice({
        type: 'ok',
        text:
          action === 'polling'
            ? 'Switched Telegram channel to Live Polling mode.'
            : action === 'remove'
            ? 'Webhook removed from channel.'
            : 'Webhook URL registered with official platform API.',
      });
    } catch (err) {
      setNotice({
        type: 'err',
        text: err instanceof Error ? err.message : 'Webhook action failed',
      });
    } finally {
      setBusy(false);
    }
  };

  const handlePermissionToggle = async (key: keyof BotPermissions) => {
    if (!activeBot) return;
    const current: BotPermissions = activeBot.permissions || {
      allowBroadcast: true,
      allowFlows: true,
      allowMedia: true,
      autoCreateCustomer: true,
    };
    await upsertBot(
      {
        ...activeBot,
        permissions: { ...current, [key]: !current[key] },
      },
      false
    );
  };

  const handleCreateChannel = async (e: React.FormEvent) => {
    e.preventDefault();
    if (newPlatform === 'viber' && viberCount >= 2) {
      setNotice({ type: 'err', text: 'Maximum 2 Viber channels allowed.' });
      return;
    }
    if (newPlatform === 'telegram' && telegramCount >= 2) {
      setNotice({ type: 'err', text: 'Maximum 2 Telegram channels allowed.' });
      return;
    }
    setBusy(true);
    setNotice(null);
    const botId = `bot_${newPlatform}_${Date.now().toString(36)}`;
    try {
      const res = await authFetch('/api/bots/verify', {
        method: 'POST',
        body: JSON.stringify({
          botId,
          name: newName.trim(),
          platform: newPlatform,
          token: newToken.trim(),
          syncMode: newPlatform === 'telegram' ? 'polling' : 'webhook',
          webhookBaseUrl: settings.defaultWebhookBaseUrl || window.location.origin,
        }),
      });
      const json = (await res.json()) as {
        ok: boolean;
        encryptedToken?: string;
        tokenMasked?: string;
        botPlatformId?: string;
        botUsername?: string;
        displayName?: string;
        webhookUrl?: string;
        webhookStatus?: BotRecord['webhookStatus'];
        syncMode?: SyncMode;
        lastSyncAt?: string;
        lastError?: string;
        error?: string;
      };
      if (!res.ok || !json.ok) {
        throw new Error(json.error || 'Channel token rejected by platform API.');
      }
      const created: BotRecord = {
        id: botId,
        ownerUid: workspaceUid,
        name: newName.trim() || json.displayName || `${newPlatform} Channel`,
        platform: newPlatform,
        status: 'connected',
        encryptedToken: json.encryptedToken,
        tokenMasked: json.tokenMasked,
        botPlatformId: json.botPlatformId || '',
        botUsername: json.botUsername || '',
        webhookUrl: json.webhookUrl || '',
        webhookStatus: json.webhookStatus || 'unset',
        syncMode: json.syncMode || (newPlatform === 'telegram' ? 'polling' : 'webhook'),
        lastSyncAt: json.lastSyncAt || new Date().toISOString(),
        lastError: json.lastError || '',
        permissions: {
          allowBroadcast: true,
          allowFlows: true,
          allowMedia: true,
          autoCreateCustomer: true,
        },
      };
      await upsertBot(created, true);
      setSelectedBotId(botId);
      setNewChannelOpen(false);
      setNewName('');
      setNewToken('');
      setNotice({ type: 'ok', text: `Channel "${created.name}" connected.` });
    } catch (err) {
      setNotice({
        type: 'err',
        text: err instanceof Error ? err.message : 'Failed to add channel',
      });
    } finally {
      setBusy(false);
    }
  };

  const currentUrl = activeBot
    ? webhookInput || activeBot.webhookUrl || defaultWebhookFor(activeBot)
    : '';

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
      {/* Left Channel Selector */}
      <div className="lg:col-span-4 rounded-2xl border border-[#D4AF37]/25 bg-[#140A0D] p-5 space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="font-display text-base font-semibold text-[#FAF7F2]">
              Configured Channels
            </h2>
            <p className="text-xs text-[#9C8B86] tabular-nums">
              {viberCount}/2 Viber · {telegramCount}/2 Telegram
            </p>
          </div>
          <button
            type="button"
            disabled={bots.length >= 4}
            onClick={() => setNewChannelOpen((v) => !v)}
            className="inline-flex items-center gap-1 rounded-lg bg-gradient-to-r from-[#991B1B] to-[#D97706] px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-40 cursor-pointer"
          >
            <Plus className="w-3.5 h-3.5" />
            Add
          </button>
        </div>

        {newChannelOpen && (
          <form
            onSubmit={handleCreateChannel}
            className="rounded-xl border border-[#D4AF37]/30 bg-[#0B0608] p-4 space-y-3"
          >
            <select
              value={newPlatform}
              onChange={(e) => setNewPlatform(e.target.value as Platform)}
              className="w-full rounded-lg border border-white/10 bg-[#140A0D] px-3 py-2 text-xs text-white"
            >
              <option value="viber" disabled={viberCount >= 2}>
                Viber Channel ({viberCount}/2)
              </option>
              <option value="telegram" disabled={telegramCount >= 2}>
                Telegram Channel ({telegramCount}/2)
              </option>
            </select>
            <input
              type="text"
              required
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="Channel name"
              className="w-full rounded-lg border border-white/10 bg-[#140A0D] px-3 py-2 text-xs text-white"
            />
            <input
              type="password"
              required
              value={newToken}
              onChange={(e) => setNewToken(e.target.value)}
              placeholder="Official Bot API Token"
              className="w-full rounded-lg border border-white/10 bg-[#140A0D] px-3 py-2 text-xs font-mono text-white"
            />
            <button
              type="submit"
              disabled={busy}
              className="w-full rounded-lg bg-gradient-to-r from-[#991B1B] to-[#D97706] py-2 text-xs font-semibold text-white cursor-pointer"
            >
              {busy ? 'Connecting...' : 'Connect Channel'}
            </button>
          </form>
        )}

        <div className="divide-y divide-white/5">
          {bots.length === 0 ? (
            <p className="py-6 text-center text-xs text-[#9C8B86]">
              No channels connected yet. Click Add to connect Viber or Telegram.
            </p>
          ) : (
            bots.map((bot) => {
              const selected = bot.id === activeBot?.id;
              return (
                <button
                  key={bot.id}
                  type="button"
                  onClick={() => handleSelectBot(bot)}
                  className={`w-full py-3 px-3 rounded-lg text-left transition flex items-center justify-between cursor-pointer ${
                    selected
                      ? 'bg-gradient-to-r from-[#7F1D1D]/45 to-[#B45309]/20'
                      : 'hover:bg-white/[0.03]'
                  }`}
                >
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-[#FAF7F2] truncate">{bot.name}</p>
                    <p className="text-[11px] text-[#9C8B86]">
                      {bot.platform.toUpperCase()} · {bot.webhookStatus || 'unset'}
                    </p>
                  </div>
                  <span
                    className={`text-[11px] font-medium ${
                      bot.status === 'connected' ? 'text-emerald-400' : 'text-amber-400'
                    }`}
                  >
                    {bot.status}
                  </span>
                </button>
              );
            })
          )}
        </div>
      </div>

      {/* Right Channel Inspector */}
      <div className="lg:col-span-8 rounded-2xl border border-[#D4AF37]/25 bg-[#140A0D] p-6 space-y-6">
        {!activeBot ? (
          <div className="py-16 text-center text-xs text-[#9C8B86]">
            Select or add a Viber or Telegram channel to configure tokens, webhooks, and permissions.
          </div>
        ) : (
          <>
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/10 pb-4">
              <div>
                <h2 className="font-display text-lg font-semibold text-[#FAF7F2]">
                  {activeBot.name} — Channel Settings
                </h2>
                <p className="text-xs text-[#9C8B86]">
                  {activeBot.platform === 'viber' ? 'Viber Bot API' : 'Telegram Bot API'} ·{' '}
                  {activeBot.botUsername || 'No username'} · ID {activeBot.botPlatformId || '—'}
                </p>
              </div>
              <button
                type="button"
                onClick={() => deleteBot(activeBot.id)}
                className="inline-flex items-center gap-1.5 rounded-lg border border-red-500/40 px-3 py-1.5 text-xs text-red-300 hover:bg-red-950/40 cursor-pointer"
              >
                <Trash2 className="w-3.5 h-3.5" />
                Remove Channel
              </button>
            </div>

            {notice && (
              <div
                className={`rounded-lg border px-4 py-3 text-xs flex items-center gap-2 ${
                  notice.type === 'ok'
                    ? 'border-emerald-500/40 bg-emerald-950/40 text-emerald-200'
                    : 'border-red-500/40 bg-red-950/40 text-red-200'
                }`}
              >
                {notice.type === 'ok' ? (
                  <CheckCircle2 className="w-4 h-4 shrink-0" />
                ) : (
                  <AlertCircle className="w-4 h-4 shrink-0" />
                )}
                <span>{notice.text}</span>
              </div>
            )}

            {activeBot.lastError && (
              <div className="rounded-lg border border-red-500/35 bg-red-950/35 px-4 py-3 text-xs text-red-200">
                Last API Error: {activeBot.lastError}
              </div>
            )}

            {/* Token Management */}
            <form onSubmit={handleUpdateTokenAndTest} className="space-y-3">
              <h3 className="text-sm font-semibold text-[#FDE68A] flex items-center gap-2">
                <Shield className="w-4 h-4" />
                API Token Vault (Masked: {activeBot.tokenMasked || 'Not set'})
              </h3>
              <div className="flex flex-col sm:flex-row gap-2">
                <input
                  type="password"
                  value={tokenInput}
                  onChange={(e) => setTokenInput(e.target.value)}
                  placeholder="Enter new API token to rotate, or leave blank to test existing"
                  className="flex-1 rounded-lg border border-white/10 bg-[#0B0608] px-3 py-2 text-xs font-mono text-white focus:border-[#D4AF37] focus:outline-none"
                />
                <button
                  type="submit"
                  disabled={busy}
                  className="inline-flex items-center justify-center gap-2 rounded-lg bg-gradient-to-r from-[#991B1B] to-[#D97706] px-4 py-2 text-xs font-semibold text-white hover:brightness-110 disabled:opacity-50 cursor-pointer whitespace-nowrap"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${busy ? 'animate-spin' : ''}`} />
                  Test & Save Token
                </button>
              </div>
            </form>

            {/* Webhook Configuration */}
            <div className="space-y-3 border-t border-white/10 pt-5">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold text-[#FDE68A] flex items-center gap-2">
                  <Link2 className="w-4 h-4" />
                  Webhook & Sync Configuration
                </h3>
                <span className="text-xs text-[#C7B7B2]">
                  Status: <strong className="text-white">{activeBot.webhookStatus || 'unset'}</strong>
                </span>
              </div>

              <div className="flex flex-col sm:flex-row gap-2">
                <input
                  type="url"
                  value={currentUrl}
                  onChange={(e) => setWebhookInput(e.target.value)}
                  className="flex-1 rounded-lg border border-white/10 bg-[#0B0608] px-3 py-2 text-xs font-mono text-[#FAF7F2] focus:border-[#D4AF37] focus:outline-none"
                />
                <button
                  type="button"
                  onClick={() => {
                    navigator.clipboard.writeText(currentUrl);
                    setCopied(true);
                    setTimeout(() => setCopied(false), 1800);
                  }}
                  className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-white/10 px-3 py-2 text-xs text-[#FAF7F2] hover:bg-white/5 cursor-pointer"
                >
                  <Copy className="w-3.5 h-3.5" />
                  {copied ? 'Copied' : 'Copy'}
                </button>
              </div>

              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => handleWebhookAction('set')}
                  className="rounded-lg border border-[#D4AF37]/40 bg-[#1B0D12] px-3.5 py-2 text-xs font-medium text-[#FDE68A] hover:bg-white/5 cursor-pointer"
                >
                  Register HTTPS Webhook
                </button>
                {activeBot.platform === 'telegram' && (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => handleWebhookAction('polling')}
                    className="rounded-lg border border-white/10 bg-[#0B0608] px-3.5 py-2 text-xs font-medium text-[#FAF7F2] hover:bg-white/5 cursor-pointer"
                  >
                    Use Live Polling Mode
                  </button>
                )}
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => handleWebhookAction('remove')}
                  className="rounded-lg border border-red-500/30 px-3.5 py-2 text-xs font-medium text-red-300 hover:bg-red-950/30 cursor-pointer"
                >
                  Remove Webhook
                </button>
              </div>
            </div>

            {/* Individual Bot Permissions */}
            <div className="space-y-3 border-t border-white/10 pt-5">
              <h3 className="text-sm font-semibold text-[#FDE68A]">
                Individual Bot Permissions
              </h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                {(
                  [
                    ['allowBroadcast', 'Allow Broadcast Campaigns'],
                    ['allowFlows', 'Allow Flow Automation Triggers'],
                    ['allowMedia', 'Allow Outgoing Images, Audio & Files'],
                    ['autoCreateCustomer', 'Auto-Register New Customers'],
                  ] as const
                ).map(([key, label]) => {
                  const enabled = activeBot.permissions?.[key] !== false;
                  return (
                    <label
                      key={key}
                      className="flex items-center justify-between rounded-lg border border-white/10 bg-[#0B0608] px-3.5 py-2.5 cursor-pointer"
                    >
                      <span className="text-[#FAF7F2]">{label}</span>
                      <input
                        type="checkbox"
                        checked={enabled}
                        onChange={() => handlePermissionToggle(key)}
                        className="accent-[#D4AF37]"
                      />
                    </label>
                  );
                })}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
};
