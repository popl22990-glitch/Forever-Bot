import React, { useState } from 'react';
import {
  Plus,
  Bot,
  Trash2,
  Edit3,
  Power,
  RefreshCw,
  CheckCircle2,
  AlertCircle,
  X,
} from 'lucide-react';
import { useStore } from '../context/StoreContext';
import { authFetch, parseApiJson } from '../lib/apiClient';
import type { BotPermissions, BotRecord, Platform, SyncMode } from '../types';

const DEFAULT_PERMISSIONS: BotPermissions = {
  allowBroadcast: true,
  allowFlows: true,
  allowMedia: true,
  autoCreateCustomer: true,
};

export const BotManagementPage: React.FC = () => {
  const { workspaceUid, bots, settings, upsertBot, deleteBot, logError } = useStore();

  const viberCount = bots.filter((b) => b.platform === 'viber').length;
  const telegramCount = bots.filter((b) => b.platform === 'telegram').length;

  const [modalOpen, setModalOpen] = useState(false);
  const [editingBot, setEditingBot] = useState<BotRecord | null>(null);

  const [name, setName] = useState('');
  const [platform, setPlatform] = useState<Platform>('telegram');
  const [token, setToken] = useState('');
  const [syncMode, setSyncMode] = useState<SyncMode>('polling');
  const [permissions, setPermissions] = useState<BotPermissions>(DEFAULT_PERMISSIONS);

  const [submitting, setSubmitting] = useState(false);
  const [testingId, setTestingId] = useState<string | null>(null);
  const [statusMsg, setStatusMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(
    null
  );

  const openAddModal = (defaultPlat: Platform) => {
    setEditingBot(null);
    setName('');
    setPlatform(defaultPlat);
    setToken('');
    setSyncMode(defaultPlat === 'telegram' ? 'polling' : 'webhook');
    setPermissions(DEFAULT_PERMISSIONS);
    setStatusMsg(null);
    setModalOpen(true);
  };

  const openEditModal = (bot: BotRecord) => {
    setEditingBot(bot);
    setName(bot.name);
    setPlatform(bot.platform);
    setToken('');
    setSyncMode(bot.syncMode || (bot.platform === 'telegram' ? 'polling' : 'webhook'));
    setPermissions(bot.permissions || DEFAULT_PERMISSIONS);
    setStatusMsg(null);
    setModalOpen(true);
  };

  const handleSaveBot = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!editingBot) {
      if (platform === 'viber' && viberCount >= 2) {
        setStatusMsg({ type: 'err', text: 'Maximum limit of 2 Viber bots reached.' });
        return;
      }
      if (platform === 'telegram' && telegramCount >= 2) {
        setStatusMsg({ type: 'err', text: 'Maximum limit of 2 Telegram bots reached.' });
        return;
      }
    }

    const botId =
      editingBot?.id || `bot_${platform}_${Date.now().toString(36)}`;

    setSubmitting(true);
    setStatusMsg(null);

    try {
      // If user supplied a new token OR bot already has encryptedToken, verify with REAL API
      const hasTokenToVerify = Boolean(token.trim() || editingBot?.encryptedToken);

      if (!hasTokenToVerify) {
        // Save as awaiting_config without pretending it's connected
        const botRecord: BotRecord = {
          id: botId,
          ownerUid: workspaceUid,
          name: name.trim() || `${platform} Bot`,
          platform,
          status: 'awaiting_config',
          encryptedToken: '',
          tokenMasked: '',
          botUsername: '',
          botPlatformId: '',
          webhookUrl: '',
          webhookStatus: 'unset',
          syncMode,
          lastSyncAt: '',
          lastError: 'Awaiting valid API token configuration.',
          permissions,
        };
        await upsertBot(botRecord, !editingBot);
        setModalOpen(false);
        return;
      }

      const res = await authFetch('/api/bots/verify', {
        method: 'POST',
        body: JSON.stringify({
          botId,
          name: name.trim(),
          platform,
          token: token.trim() || undefined,
          encryptedToken: !token.trim() ? editingBot?.encryptedToken : undefined,
          syncMode,
          webhookBaseUrl: settings.defaultWebhookBaseUrl || window.location.origin,
        }),
      });
      const json = await parseApiJson<{
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
      }>(res);

      if (!res.ok || !json.ok) {
        throw new Error(json.error || 'Bot API rejected the credentials.');
      }

      const botRecord: BotRecord = {
        id: botId,
        ownerUid: workspaceUid,
        name: name.trim() || json.displayName || `${platform} Bot`,
        platform,
        status: 'connected',
        encryptedToken: json.encryptedToken,
        tokenMasked: json.tokenMasked,
        botUsername: json.botUsername || '',
        botPlatformId: json.botPlatformId || '',
        webhookUrl: json.webhookUrl || '',
        webhookStatus: json.webhookStatus || 'unset',
        syncMode: json.syncMode || syncMode,
        lastSyncAt: json.lastSyncAt || new Date().toISOString(),
        lastError: json.lastError || '',
        permissions,
      };

      await upsertBot(botRecord, !editingBot);
      setModalOpen(false);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to connect bot';
      setStatusMsg({ type: 'err', text: msg });
      await logError(
        platform === 'viber' ? 'viber_api' : 'telegram_api',
        `Bot connection failed (${name || botId})`,
        msg,
        botId
      );
    } finally {
      setSubmitting(false);
    }
  };

  const handleTestConnection = async (bot: BotRecord) => {
    if (!bot.encryptedToken) {
      setStatusMsg({
        type: 'err',
        text: `Bot "${bot.name}" is awaiting API token configuration.`,
      });
      return;
    }
    setTestingId(bot.id);
    setStatusMsg(null);
    try {
      const res = await authFetch('/api/bots/verify', {
        method: 'POST',
        body: JSON.stringify({
          botId: bot.id,
          name: bot.name,
          platform: bot.platform,
          encryptedToken: bot.encryptedToken,
          syncMode: bot.syncMode || (bot.platform === 'telegram' ? 'polling' : 'webhook'),
          webhookBaseUrl: settings.defaultWebhookBaseUrl || window.location.origin,
        }),
      });
      const json = await parseApiJson<{
        ok: boolean;
        lastSyncAt?: string;
        webhookStatus?: BotRecord['webhookStatus'];
        webhookUrl?: string;
        botUsername?: string;
        error?: string;
      }>(res);

      if (!res.ok || !json.ok) {
        await upsertBot(
          {
            ...bot,
            status: 'error',
            lastError: json.error || 'Connection test failed',
          },
          false
        );
        throw new Error(json.error || 'Connection test failed');
      }

      await upsertBot(
        {
          ...bot,
          status: 'connected',
          botUsername: json.botUsername || bot.botUsername,
          webhookStatus: json.webhookStatus || bot.webhookStatus,
          webhookUrl: json.webhookUrl || bot.webhookUrl,
          lastSyncAt: json.lastSyncAt || new Date().toISOString(),
          lastError: '',
        },
        false
      );
      setStatusMsg({
        type: 'ok',
        text: `Live connection verified for "${bot.name}" (${json.botUsername || bot.platform}).`,
      });
    } catch (err) {
      setStatusMsg({
        type: 'err',
        text: err instanceof Error ? err.message : 'Test connection failed',
      });
    } finally {
      setTestingId(null);
    }
  };

  const handleToggleConnect = async (bot: BotRecord) => {
    if (bot.status === 'connected') {
      await authFetch(`/api/bots/${encodeURIComponent(bot.id)}/disconnect`, {
        method: 'POST',
      }).catch(() => {});
      await upsertBot({ ...bot, status: 'disconnected' }, false);
    } else {
      await handleTestConnection(bot);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header & Quota Strip */}
      <div className="rounded-2xl border border-[#D4AF37]/25 bg-[#140A0D] p-6 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="font-display text-lg font-semibold text-[#FAF7F2]">
            Multi-Bot Fleet ({bots.length} / 4 Slots Used)
          </h2>
          <p className="text-xs text-[#9C8B86] mt-1 tabular-nums">
            Viber Bots: {viberCount} / 2 · Telegram Bots: {telegramCount} / 2
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            disabled={viberCount >= 2}
            onClick={() => openAddModal('viber')}
            className="inline-flex items-center gap-2 rounded-lg border border-[#D4AF37]/40 bg-[#1D0D13] px-3.5 py-2 text-xs font-semibold text-[#FDE68A] hover:bg-[#7F1D1D]/40 transition disabled:opacity-40 cursor-pointer whitespace-nowrap"
          >
            <Plus className="w-4 h-4" />
            Add Viber Bot
          </button>
          <button
            type="button"
            disabled={telegramCount >= 2}
            onClick={() => openAddModal('telegram')}
            className="inline-flex items-center gap-2 rounded-lg bg-gradient-to-r from-[#991B1B] to-[#D97706] px-3.5 py-2 text-xs font-semibold text-white hover:brightness-110 transition disabled:opacity-40 cursor-pointer whitespace-nowrap"
          >
            <Plus className="w-4 h-4" />
            Add Telegram Bot
          </button>
        </div>
      </div>

      {statusMsg && (
        <div
          className={`rounded-xl border px-4 py-3 text-xs flex items-center gap-2 ${
            statusMsg.type === 'ok'
              ? 'border-emerald-500/40 bg-emerald-950/40 text-emerald-200'
              : 'border-red-500/40 bg-red-950/40 text-red-200'
          }`}
        >
          {statusMsg.type === 'ok' ? (
            <CheckCircle2 className="w-4 h-4 shrink-0" />
          ) : (
            <AlertCircle className="w-4 h-4 shrink-0" />
          )}
          <span>{statusMsg.text}</span>
        </div>
      )}

      {/* Bot Cards */}
      {bots.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-[#D4AF37]/30 bg-[#140A0D] p-12 text-center space-y-3">
          <Bot className="w-10 h-10 text-[#D4AF37]/50 mx-auto" />
          <h3 className="font-display text-base font-semibold text-[#FAF7F2]">
            No Bots Configured Yet
          </h3>
          <p className="text-xs text-[#9C8B86] max-w-md mx-auto">
            Connect up to 2 official Viber Bots and 2 official Telegram Bots using their real Bot API tokens. Tokens are encrypted and stored strictly on the server.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {bots.map((bot) => (
            <div
              key={bot.id}
              className="rounded-2xl border border-[#D4AF37]/25 bg-[#140A0D] p-5 space-y-4"
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="font-display text-base font-semibold text-[#FAF7F2]">
                      {bot.name}
                    </h3>
                  </div>
                  <p className="text-xs text-[#9C8B86] mt-0.5">
                    {bot.platform === 'viber' ? 'Viber Bot API' : 'Telegram Bot API'} ·{' '}
                    {bot.botUsername || 'Unverified'}
                  </p>
                </div>
                <span
                  className={`text-xs font-semibold ${
                    bot.status === 'connected'
                      ? 'text-emerald-400'
                      : bot.status === 'error'
                      ? 'text-red-400'
                      : 'text-amber-400'
                  }`}
                >
                  {bot.status === 'connected'
                    ? 'Connected'
                    : bot.status === 'awaiting_config'
                    ? 'Awaiting Configuration'
                    : bot.status}
                </span>
              </div>

              <div className="grid grid-cols-2 gap-3 text-xs border-t border-b border-white/10 py-3">
                <div>
                  <p className="text-[#7D6C67]">Encrypted Token</p>
                  <p className="font-mono text-[#FAF7F2] mt-0.5">
                    {bot.tokenMasked || 'Not configured'}
                  </p>
                </div>
                <div>
                  <p className="text-[#7D6C67]">Sync Mode</p>
                  <p className="text-[#FAF7F2] mt-0.5">
                    {bot.syncMode === 'polling' ? 'Live Polling' : 'Webhook'} (
                    {bot.webhookStatus || 'unset'})
                  </p>
                </div>
                <div>
                  <p className="text-[#7D6C67]">Last Sync</p>
                  <p className="font-mono text-[#C7B7B2] mt-0.5 tabular-nums">
                    {bot.lastSyncAt
                      ? new Date(bot.lastSyncAt).toLocaleString([], {
                          month: 'short',
                          day: 'numeric',
                          hour: '2-digit',
                          minute: '2-digit',
                        })
                      : 'Never'}
                  </p>
                </div>
                <div>
                  <p className="text-[#7D6C67]">Permissions</p>
                  <p className="text-[#C7B7B2] mt-0.5">
                    {[
                      bot.permissions?.allowBroadcast !== false && 'Broadcast',
                      bot.permissions?.allowFlows !== false && 'Flows',
                      bot.permissions?.allowMedia !== false && 'Media',
                    ]
                      .filter(Boolean)
                      .join(' · ') || 'Restricted'}
                  </p>
                </div>
              </div>

              {bot.lastError && (
                <p className="text-xs text-red-300 bg-red-950/40 border border-red-500/30 rounded-lg px-3 py-2">
                  {bot.lastError}
                </p>
              )}

              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    disabled={testingId === bot.id}
                    onClick={() => handleTestConnection(bot)}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-[#D4AF37]/35 px-3 py-1.5 text-xs font-medium text-[#FDE68A] hover:bg-white/5 cursor-pointer disabled:opacity-50"
                  >
                    <RefreshCw
                      className={`w-3.5 h-3.5 ${testingId === bot.id ? 'animate-spin' : ''}`}
                    />
                    Test Connection
                  </button>
                  <button
                    type="button"
                    onClick={() => handleToggleConnect(bot)}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 px-3 py-1.5 text-xs font-medium text-[#FAF7F2] hover:bg-white/5 cursor-pointer"
                  >
                    <Power className="w-3.5 h-3.5" />
                    {bot.status === 'connected' ? 'Disconnect' : 'Connect'}
                  </button>
                </div>

                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => openEditModal(bot)}
                    aria-label="Edit bot"
                    className="p-2 rounded-lg border border-white/10 text-[#C7B7B2] hover:text-white cursor-pointer"
                  >
                    <Edit3 className="w-3.5 h-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => deleteBot(bot.id)}
                    aria-label="Delete bot"
                    className="p-2 rounded-lg border border-white/10 text-red-400 hover:bg-red-950/40 cursor-pointer"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Add/Edit Bot Modal */}
      {modalOpen && (
        <div className="fixed inset-0 z-50 bg-black/75 flex items-center justify-center p-4">
          <form
            onSubmit={handleSaveBot}
            className="max-w-lg w-full rounded-2xl border border-[#D4AF37]/40 bg-[#140A0D] p-6 space-y-4"
          >
            <div className="flex items-center justify-between border-b border-white/10 pb-3">
              <h3 className="font-display text-base font-semibold text-[#FAF7F2]">
                {editingBot
                  ? `Edit ${editingBot.name}`
                  : `Connect ${platform === 'viber' ? 'Viber' : 'Telegram'} Bot`}
              </h3>
              <button
                type="button"
                onClick={() => setModalOpen(false)}
                className="text-[#9C8B86] hover:text-white cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {statusMsg && statusMsg.type === 'err' && (
              <div className="rounded-lg border border-red-500/40 bg-red-950/40 px-3 py-2 text-xs text-red-200">
                {statusMsg.text}
              </div>
            )}

            <div className="space-y-1.5">
              <label className="block text-xs font-medium text-[#C7B7B2]">
                Custom Bot Name
              </label>
              <input
                type="text"
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g., Forever Support Desk"
                className="w-full rounded-lg border border-white/10 bg-[#0B0608] px-3 py-2 text-sm text-white focus:border-[#D4AF37] focus:outline-none"
              />
            </div>

            <div className="space-y-1.5">
              <label className="block text-xs font-medium text-[#C7B7B2]">
                {platform === 'viber'
                  ? 'Viber Auth Token (from Viber Partners)'
                  : 'Telegram Bot API Token (from @BotFather)'}
              </label>
              <input
                type="password"
                value={token}
                onChange={(e) => setToken(e.target.value)}
                placeholder={
                  editingBot?.tokenMasked
                    ? `Current: ${editingBot.tokenMasked} (leave blank to keep)`
                    : 'Paste real API token...'
                }
                className="w-full rounded-lg border border-white/10 bg-[#0B0608] px-3 py-2 text-sm font-mono text-white focus:border-[#D4AF37] focus:outline-none"
              />
              <p className="text-[11px] text-[#7D6C67]">
                Tokens are verified against the official API and encrypted on the server.
              </p>
            </div>

            {platform === 'telegram' && (
              <div className="space-y-1.5">
                <label className="block text-xs font-medium text-[#C7B7B2]">
                  Incoming Message Mode
                </label>
                <select
                  value={syncMode}
                  onChange={(e) => setSyncMode(e.target.value as SyncMode)}
                  className="w-full rounded-lg border border-white/10 bg-[#0B0608] px-3 py-2 text-sm text-white focus:border-[#D4AF37] focus:outline-none"
                >
                  <option value="polling">
                    Live Polling (Recommended — works immediately)
                  </option>
                  <option value="webhook">
                    HTTPS Webhook (Requires public HTTPS callback URL)
                  </option>
                </select>
              </div>
            )}

            <div className="space-y-2 border-t border-white/10 pt-3">
              <p className="text-xs font-medium text-[#C7B7B2]">Bot Permissions</p>
              <div className="grid grid-cols-2 gap-2 text-xs text-[#FAF7F2]">
                {(
                  [
                    ['allowBroadcast', 'Allow Broadcasts'],
                    ['allowFlows', 'Allow Flow Automation'],
                    ['allowMedia', 'Allow Image/Audio/File'],
                    ['autoCreateCustomer', 'Auto-Register Customers'],
                  ] as const
                ).map(([key, label]) => (
                  <label key={key} className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={permissions[key]}
                      onChange={(e) =>
                        setPermissions((p) => ({ ...p, [key]: e.target.checked }))
                      }
                      className="accent-[#D4AF37]"
                    />
                    <span>{label}</span>
                  </label>
                ))}
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setModalOpen(false)}
                className="px-4 py-2 rounded-lg border border-white/10 text-xs text-[#C7B7B2] hover:bg-white/5 cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={submitting}
                className="px-4 py-2 rounded-lg bg-gradient-to-r from-[#991B1B] to-[#D97706] text-xs font-semibold text-white hover:brightness-110 disabled:opacity-50 cursor-pointer"
              >
                {submitting ? 'Verifying API...' : 'Verify & Save Bot'}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
};
