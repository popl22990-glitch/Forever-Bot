import React, { useEffect, useState } from 'react';
import {
  Save,
  Download,
  RefreshCw,
  Database,
  ShieldCheck,
  Trash2,
  CheckCircle2,
  AlertCircle,
} from 'lucide-react';
import { useStore } from '../context/StoreContext';
import { testConnection } from '../lib/firebase';

interface HealthStatus {
  ok: boolean;
  uptimeSeconds?: number;
  activeBotsInVault?: number;
  totalBotsInVault?: number;
  wsClients?: number;
  database?: string;
  timestamp?: string;
}

export const GeneralSettingsPage: React.FC = () => {
  const {
    bots,
    customers,
    messages,
    broadcasts,
    flows,
    settings,
    errorLogs,
    saveSettings,
    clearErrorLog,
  } = useStore();

  const [platformName, setPlatformName] = useState(settings.platformName);
  const [webhookBaseUrl, setWebhookBaseUrl] = useState(
    settings.defaultWebhookBaseUrl || window.location.origin
  );
  const [rateLimitMs, setRateLimitMs] = useState(settings.broadcastRateLimitMs);
  const [requireConfirm, setRequireConfirm] = useState(settings.broadcastRequireConfirm);

  const [health, setHealth] = useState<HealthStatus | null>(null);
  const [dbOnline, setDbOnline] = useState<boolean | null>(null);
  const [checkingHealth, setCheckingHealth] = useState(false);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    setPlatformName(settings.platformName);
    setWebhookBaseUrl(settings.defaultWebhookBaseUrl || window.location.origin);
    setRateLimitMs(settings.broadcastRateLimitMs);
    setRequireConfirm(settings.broadcastRequireConfirm);
  }, [settings]);

  const runHealthCheck = async () => {
    setCheckingHealth(true);
    try {
      const [apiRes, firestoreOk] = await Promise.all([
        fetch('/api/health').then((r) => r.json() as Promise<HealthStatus>),
        testConnection(),
      ]);
      setHealth(apiRes);
      setDbOnline(firestoreOk);
    } catch {
      setHealth({ ok: false });
      setDbOnline(false);
    } finally {
      setCheckingHealth(false);
    }
  };

  useEffect(() => {
    runHealthCheck();
  }, []);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setNotice(null);
    await saveSettings({
      platformName: platformName.trim() || 'FOREVER BOT',
      defaultWebhookBaseUrl: webhookBaseUrl.trim() || window.location.origin,
      broadcastRateLimitMs: Number(rateLimitMs) || 180,
      broadcastRequireConfirm: requireConfirm,
    });
    setSaving(false);
    setNotice('Administrator settings persisted to Firestore.');
  };

  const handleExportBackup = () => {
    const sanitizedBots = bots.map(({ encryptedToken: _omit, ...safe }) => safe);
    const backup = {
      exportedAt: new Date().toISOString(),
      platform: platformName,
      bots: sanitizedBots,
      customers,
      messages,
      broadcasts,
      flows,
    };
    const blob = new Blob([JSON.stringify(backup, null, 2)], {
      type: 'application/json',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `forever-bot-backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Platform & Broadcast Config */}
        <form
          onSubmit={handleSave}
          className="lg:col-span-7 rounded-2xl border border-[#D4AF37]/25 bg-[#140A0D] p-6 space-y-5"
        >
          <div className="border-b border-white/10 pb-3">
            <h2 className="font-display text-lg font-semibold text-[#FAF7F2]">
              Platform & Broadcast Configuration
            </h2>
            <p className="text-xs text-[#9C8B86]">
              Configure global webhook base URLs, queue throttling, and administrator safeguards.
            </p>
          </div>

          {notice && (
            <div className="rounded-lg border border-emerald-500/40 bg-emerald-950/40 px-4 py-2.5 text-xs text-emerald-200 flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 shrink-0" />
              <span>{notice}</span>
            </div>
          )}

          <div className="space-y-1.5">
            <label className="block text-xs font-medium text-[#C7B7B2]">
              Platform Name
            </label>
            <input
              type="text"
              value={platformName}
              onChange={(e) => setPlatformName(e.target.value)}
              className="w-full rounded-lg border border-white/10 bg-[#0B0608] px-3 py-2 text-sm text-white"
            />
          </div>

          <div className="space-y-1.5">
            <label className="block text-xs font-medium text-[#C7B7B2]">
              Default Webhook Base URL
            </label>
            <input
              type="url"
              value={webhookBaseUrl}
              onChange={(e) => setWebhookBaseUrl(e.target.value)}
              className="w-full rounded-lg border border-white/10 bg-[#0B0608] px-3 py-2 text-xs font-mono text-white"
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <label className="block text-xs font-medium text-[#C7B7B2]">
                Broadcast Rate Limit (ms/message)
              </label>
              <input
                type="number"
                min={80}
                max={5000}
                value={rateLimitMs}
                onChange={(e) => setRateLimitMs(Number(e.target.value))}
                className="w-full rounded-lg border border-white/10 bg-[#0B0608] px-3 py-2 text-sm font-mono text-white"
              />
            </div>

            <label className="flex items-center justify-between rounded-xl border border-white/10 bg-[#0B0608] px-4 py-3 cursor-pointer">
              <div>
                <p className="text-xs font-medium text-[#FAF7F2]">
                  Broadcast Confirmation
                </p>
                <p className="text-[11px] text-[#9C8B86]">
                  Prevent accidental sends
                </p>
              </div>
              <input
                type="checkbox"
                checked={requireConfirm}
                onChange={(e) => setRequireConfirm(e.target.checked)}
                className="accent-[#D4AF37]"
              />
            </label>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
            <button
              type="button"
              onClick={handleExportBackup}
              className="inline-flex items-center gap-2 rounded-lg border border-[#D4AF37]/40 px-4 py-2 text-xs font-medium text-[#FDE68A] hover:bg-white/5 cursor-pointer"
            >
              <Download className="w-4 h-4" />
              Export Database Backup (JSON)
            </button>

            <button
              type="submit"
              disabled={saving}
              className="inline-flex items-center gap-2 rounded-lg bg-gradient-to-r from-[#991B1B] to-[#D97706] px-5 py-2 text-xs font-semibold text-white hover:brightness-110 cursor-pointer"
            >
              <Save className="w-4 h-4" />
              {saving ? 'Saving...' : 'Save Configuration'}
            </button>
          </div>
        </form>

        {/* System Health & Database Status */}
        <div className="lg:col-span-5 rounded-2xl border border-[#D4AF37]/25 bg-[#140A0D] p-6 space-y-4">
          <div className="flex items-center justify-between border-b border-white/10 pb-3">
            <h2 className="font-display text-base font-semibold text-[#FAF7F2]">
              System Health & Database
            </h2>
            <button
              type="button"
              onClick={runHealthCheck}
              className="inline-flex items-center gap-1.5 text-xs text-[#FDE68A] hover:underline cursor-pointer"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${checkingHealth ? 'animate-spin' : ''}`} />
              Refresh
            </button>
          </div>

          <div className="space-y-3 text-xs">
            <div className="flex items-center justify-between py-1.5 border-b border-white/5">
              <span className="text-[#B8A8A3] inline-flex items-center gap-2">
                <Database className="w-4 h-4 text-[#D4AF37]" />
                Cloud Firestore Persistence
              </span>
              <span className={dbOnline ? 'text-emerald-400 font-semibold' : 'text-red-400'}>
                {dbOnline === null ? 'Checking...' : dbOnline ? 'Connected' : 'Offline'}
              </span>
            </div>

            <div className="flex items-center justify-between py-1.5 border-b border-white/5">
              <span className="text-[#B8A8A3] inline-flex items-center gap-2">
                <ShieldCheck className="w-4 h-4 text-[#D4AF37]" />
                Token Vault Encryption
              </span>
              <span className="text-emerald-400 font-semibold">AES-256-GCM Server-Side</span>
            </div>

            <div className="flex items-center justify-between py-1.5 border-b border-white/5">
              <span className="text-[#B8A8A3]">Backend API Server</span>
              <span className={health?.ok ? 'text-emerald-400 font-semibold' : 'text-red-400'}>
                {health?.ok ? `Healthy (${health.uptimeSeconds}s uptime)` : 'Unavailable'}
              </span>
            </div>

            <div className="flex items-center justify-between py-1.5 border-b border-white/5">
              <span className="text-[#B8A8A3]">Active Bots in Server Vault</span>
              <span className="font-mono text-[#FAF7F2] tabular-nums">
                {health?.activeBotsInVault ?? 0} / {health?.totalBotsInVault ?? 0}
              </span>
            </div>

            <div className="flex items-center justify-between py-1.5">
              <span className="text-[#B8A8A3]">Connected Admin Sockets</span>
              <span className="font-mono text-[#FAF7F2] tabular-nums">
                {health?.wsClients ?? 0}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Error Logs */}
      <div className="rounded-2xl border border-[#D4AF37]/25 bg-[#140A0D] p-6 space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="font-display text-base font-semibold text-[#FAF7F2]">
            API, Webhook & System Error Logs ({errorLogs.length})
          </h3>
        </div>

        {errorLogs.length === 0 ? (
          <p className="text-xs text-[#9C8B86]">No errors recorded.</p>
        ) : (
          <div className="divide-y divide-white/5">
            {errorLogs.map((log) => (
              <div
                key={log.id}
                className="py-3 flex items-start justify-between gap-4 text-xs"
              >
                <div className="space-y-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <AlertCircle className="w-3.5 h-3.5 text-red-400 shrink-0" />
                    <span className="font-medium text-[#FAF7F2]">{log.message}</span>
                    <span className="text-[#9C8B86] font-mono">· {log.source}</span>
                  </div>
                  {log.details && (
                    <p className="text-[11px] text-[#9C8B86] break-words pl-5">
                      {log.details}
                    </p>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => clearErrorLog(log.id)}
                  aria-label="Clear error log"
                  className="text-[#9C8B86] hover:text-red-400 shrink-0 cursor-pointer"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
