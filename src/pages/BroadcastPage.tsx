import React, { useMemo, useRef, useState } from 'react';
import {
  Send,
  Image as ImageIcon,
  Music,
  Paperclip,
  StopCircle,
  AlertCircle,
  CheckCircle2,
  Users,
  X,
} from 'lucide-react';
import { useStore } from '../context/StoreContext';
import { authFetch } from '../lib/apiClient';
import type { BroadcastRecord, MessageType } from '../types';

export const BroadcastPage: React.FC = () => {
  const { workspaceUid, bots, customers, broadcasts, settings, createBroadcast } = useStore();

  const connectedBots = useMemo(
    () => bots.filter((b) => b.status === 'connected'),
    [bots]
  );

  const [selectedBotId, setSelectedBotId] = useState<string>('');
  const activeBot = useMemo(
    () =>
      connectedBots.find((b) => b.id === selectedBotId) ||
      connectedBots[0] ||
      null,
    [connectedBots, selectedBotId]
  );

  const eligibleCustomers = useMemo(() => {
    if (!activeBot) return [];
    return customers.filter(
      (c) => c.botId === activeBot.id && c.isSubscribed
    );
  }, [customers, activeBot]);

  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [title, setTitle] = useState('');
  const [messageType, setMessageType] = useState<MessageType>('text');
  const [text, setText] = useState('');
  const [mediaUrl, setMediaUrl] = useState('');
  const [localFilePath, setLocalFilePath] = useState('');
  const [fileBase64, setFileBase64] = useState('');
  const [fileName, setFileName] = useState('');
  const [fileSize, setFileSize] = useState(0);

  const [uploading, setUploading] = useState(false);
  const [launching, setLaunching] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [feedback, setFeedback] = useState<{ type: 'ok' | 'err'; msg: string } | null>(
    null
  );

  const fileRef = useRef<HTMLInputElement>(null);

  const effectiveSelected = useMemo(() => {
    const validIds = new Set(eligibleCustomers.map((c) => c.id));
    return Array.from(selectedIds).filter((id) => validIds.has(id));
  }, [selectedIds, eligibleCustomers]);

  const toggleRecipient = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selectAll = () => {
    setSelectedIds(new Set(eligibleCustomers.map((c) => c.id)));
  };

  const clearAll = () => {
    setSelectedIds(new Set());
  };

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setUploading(true);
    setFeedback(null);
    try {
      const fd = new FormData();
      fd.append('file', file);
      const res = await authFetch('/api/upload', { method: 'POST', body: fd });
      const json = (await res.json()) as {
        ok?: boolean;
        url?: string;
        localPath?: string;
        fileBase64?: string;
        fileName?: string;
        fileSize?: number;
        error?: string;
      };
      if (!res.ok || !json.url) throw new Error(json.error || 'Upload failed');
      setMediaUrl(json.url);
      setLocalFilePath(json.localPath || '');
      setFileBase64(json.fileBase64 || '');
      setFileName(json.fileName || file.name);
      setFileSize(json.fileSize || file.size);
    } catch (err) {
      setFeedback({
        type: 'err',
        msg: err instanceof Error ? err.message : 'Upload failed',
      });
    } finally {
      setUploading(false);
    }
  };

  const launchBroadcast = async () => {
    if (!activeBot) return;
    if (effectiveSelected.length === 0) {
      setFeedback({ type: 'err', msg: 'Select at least one eligible customer.' });
      return;
    }
    if (messageType === 'text' && !text.trim()) {
      setFeedback({ type: 'err', msg: 'Enter broadcast message text.' });
      return;
    }
    if (messageType !== 'text' && !mediaUrl.trim()) {
      setFeedback({ type: 'err', msg: 'Upload a media file or enter an HTTPS media URL.' });
      return;
    }

    setLaunching(true);
    setConfirmOpen(false);
    setFeedback(null);

    const recipients = eligibleCustomers
      .filter((c) => effectiveSelected.includes(c.id))
      .map((c) => ({
        customerId: c.id,
        platformUserId: c.platformUserId,
        displayName: c.displayName,
      }));

    const broadcastId = `bc_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const dedupeKey = `${activeBot.id}:${messageType}:${text.trim()}:${mediaUrl.trim()}:${recipients
      .map((r) => r.platformUserId)
      .sort()
      .join(',')}`;

    try {
      const res = await authFetch('/api/broadcasts/send', {
        method: 'POST',
        body: JSON.stringify({
          broadcastId,
          botId: activeBot.id,
          platform: activeBot.platform,
          botName: activeBot.name,
          encryptedToken: activeBot.encryptedToken,
          recipients,
          messageType,
          text: text.trim(),
          mediaUrl: mediaUrl.trim(),
          localFilePath,
          fileBase64,
          fileName,
          fileSize,
          dedupeKey,
          rateLimitMs: settings.broadcastRateLimitMs,
        }),
      });
      const json = (await res.json()) as { ok: boolean; error?: string };
      if (!res.ok || !json.ok) {
        throw new Error(json.error || 'Broadcast failed to start');
      }

      const record: BroadcastRecord = {
        id: broadcastId,
        ownerUid: workspaceUid,
        title: title.trim() || `${activeBot.name} Campaign`,
        botId: activeBot.id,
        platform: activeBot.platform,
        messageType,
        text: text.trim(),
        mediaUrl: mediaUrl.trim(),
        dedupeKey: dedupeKey.slice(0, 120),
        totalTargets: recipients.length,
        successCount: 0,
        failedCount: 0,
        status: 'running',
        startedAt: new Date().toISOString(),
        completedAt: '',
      };
      await createBroadcast(record);
      setFeedback({
        type: 'ok',
        msg: `Broadcast queued for ${recipients.length} real subscribers with rate-limit protection.`,
      });
    } catch (err) {
      setFeedback({
        type: 'err',
        msg: err instanceof Error ? err.message : 'Failed to start broadcast',
      });
    } finally {
      setLaunching(false);
    }
  };

  const handleCancelBroadcast = async (broadcastId: string) => {
    await authFetch(`/api/broadcasts/${encodeURIComponent(broadcastId)}/cancel`, {
      method: 'POST',
    });
  };

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-6">
        {/* Composer */}
        <div className="xl:col-span-7 rounded-2xl border border-[#D4AF37]/25 bg-[#140A0D] p-6 space-y-5">
          <div className="flex items-center justify-between border-b border-white/10 pb-4">
            <div>
              <h2 className="font-display text-lg font-semibold text-[#FAF7F2]">
                New Broadcast Campaign
              </h2>
              <p className="text-xs text-[#9C8B86]">
                Deliveries strictly target real subscribed customers with queue throttling and deduplication.
              </p>
            </div>
          </div>

          {feedback && (
            <div
              className={`rounded-lg border px-4 py-3 text-xs flex items-center gap-2 ${
                feedback.type === 'ok'
                  ? 'border-emerald-500/40 bg-emerald-950/40 text-emerald-200'
                  : 'border-red-500/40 bg-red-950/40 text-red-200'
              }`}
            >
              {feedback.type === 'ok' ? (
                <CheckCircle2 className="w-4 h-4 shrink-0" />
              ) : (
                <AlertCircle className="w-4 h-4 shrink-0" />
              )}
              <span>{feedback.msg}</span>
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <label className="block text-xs font-medium text-[#C7B7B2]">
                Connected Bot
              </label>
              <select
                value={activeBot?.id || ''}
                onChange={(e) => {
                  setSelectedBotId(e.target.value);
                  setSelectedIds(new Set());
                }}
                className="w-full rounded-lg border border-white/10 bg-[#0B0608] px-3 py-2 text-sm text-[#FAF7F2] focus:border-[#D4AF37] focus:outline-none"
              >
                {connectedBots.length === 0 ? (
                  <option value="">No connected bots available</option>
                ) : (
                  connectedBots.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name} ({b.platform === 'viber' ? 'Viber' : 'Telegram'})
                    </option>
                  ))
                )}
              </select>
            </div>

            <div className="space-y-1.5">
              <label className="block text-xs font-medium text-[#C7B7B2]">
                Campaign Title
              </label>
              <input
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="e.g., VIP Promotion Update"
                className="w-full rounded-lg border border-white/10 bg-[#0B0608] px-3 py-2 text-sm text-[#FAF7F2] placeholder-[#7D6C67] focus:border-[#D4AF37] focus:outline-none"
              />
            </div>
          </div>

          <div className="space-y-2">
            <label className="block text-xs font-medium text-[#C7B7B2]">
              Message Format
            </label>
            <div className="flex flex-wrap gap-2">
              {(
                [
                  { id: 'text', label: 'Text Message', icon: Send },
                  { id: 'image', label: 'Image + Caption', icon: ImageIcon },
                  { id: 'audio', label: 'Audio', icon: Music },
                  { id: 'file', label: 'Document / File', icon: Paperclip },
                ] as const
              ).map((item) => {
                const Icon = item.icon;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => setMessageType(item.id)}
                    className={`inline-flex items-center gap-2 rounded-lg px-3 py-2 text-xs font-medium border transition cursor-pointer ${
                      messageType === item.id
                        ? 'border-[#D4AF37] bg-gradient-to-r from-[#991B1B]/60 to-[#B45309]/40 text-white'
                        : 'border-white/10 bg-[#0B0608] text-[#B8A8A3] hover:text-white'
                    }`}
                  >
                    <Icon className="w-3.5 h-3.5" />
                    <span>{item.label}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {messageType !== 'text' && (
            <div className="space-y-2">
              <label className="block text-xs font-medium text-[#C7B7B2]">
                Media File or HTTPS URL
              </label>
              <div className="flex gap-2">
                <input
                  type="url"
                  value={mediaUrl}
                  onChange={(e) => {
                    setMediaUrl(e.target.value);
                    setLocalFilePath('');
                    setFileBase64('');
                  }}
                  placeholder="https://... or upload below"
                  className="flex-1 rounded-lg border border-white/10 bg-[#0B0608] px-3 py-2 text-xs text-[#FAF7F2] placeholder-[#7D6C67] focus:border-[#D4AF37] focus:outline-none"
                />
                <input
                  ref={fileRef}
                  type="file"
                  className="hidden"
                  accept={
                    messageType === 'image'
                      ? 'image/*'
                      : messageType === 'audio'
                      ? 'audio/*'
                      : '*/*'
                  }
                  onChange={handleUpload}
                />
                <button
                  type="button"
                  disabled={uploading}
                  onClick={() => fileRef.current?.click()}
                  className="rounded-lg border border-[#D4AF37]/40 bg-[#0B0608] px-3.5 py-2 text-xs font-medium text-[#FDE68A] hover:bg-white/5 cursor-pointer whitespace-nowrap"
                >
                  {uploading ? 'Uploading...' : 'Upload File'}
                </button>
              </div>
              {fileName && (
                <p className="text-[11px] text-[#9C8B86]">Uploaded: {fileName}</p>
              )}
            </div>
          )}

          <div className="space-y-1.5">
            <label className="block text-xs font-medium text-[#C7B7B2]">
              {messageType === 'text' ? 'Message Body' : 'Caption (Optional)'}
            </label>
            <textarea
              rows={4}
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="Write your broadcast message..."
              className="w-full rounded-lg border border-white/10 bg-[#0B0608] px-3.5 py-2.5 text-sm text-[#FAF7F2] placeholder-[#7D6C67] focus:border-[#D4AF37] focus:outline-none"
            />
          </div>

          {/* Recipient Selector */}
          <div className="space-y-2 border-t border-white/10 pt-4">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-[#FAF7F2] tabular-nums">
                Eligible Subscribers ({effectiveSelected.length} / {eligibleCustomers.length} selected)
              </span>
              <div className="flex items-center gap-3 text-xs">
                <button
                  type="button"
                  onClick={selectAll}
                  className="text-[#FDE68A] hover:underline cursor-pointer"
                >
                  Select All
                </button>
                <button
                  type="button"
                  onClick={clearAll}
                  className="text-[#9C8B86] hover:text-white cursor-pointer"
                >
                  Clear
                </button>
              </div>
            </div>

            {eligibleCustomers.length === 0 ? (
              <div className="rounded-lg border border-dashed border-white/15 p-4 text-center text-xs text-[#9C8B86]">
                No eligible subscribers found for this bot yet. Real customers appear once they message or subscribe to the bot.
              </div>
            ) : (
              <div className="max-h-48 overflow-y-auto rounded-lg border border-white/10 bg-[#0B0608] divide-y divide-white/5">
                {eligibleCustomers.map((c) => {
                  const checked = effectiveSelected.includes(c.id);
                  return (
                    <label
                      key={c.id}
                      className="flex items-center justify-between px-3 py-2 text-xs hover:bg-white/[0.03] cursor-pointer"
                    >
                      <div className="flex items-center gap-2.5 min-w-0">
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => toggleRecipient(c.id)}
                          className="accent-[#D4AF37]"
                        />
                        <span className="text-[#FAF7F2] truncate">{c.displayName}</span>
                      </div>
                      <span className="font-mono text-[11px] text-[#7D6C67] shrink-0">
                        {c.platformUserId}
                      </span>
                    </label>
                  );
                })}
              </div>
            )}
          </div>

          <div className="flex justify-end pt-2">
            <button
              type="button"
              disabled={launching || !activeBot || effectiveSelected.length === 0}
              onClick={() =>
                settings.broadcastRequireConfirm
                  ? setConfirmOpen(true)
                  : launchBroadcast()
              }
              className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-[#991B1B] via-[#B91C1C] to-[#D97706] px-5 py-2.5 text-sm font-semibold text-white hover:brightness-110 transition disabled:opacity-40 cursor-pointer"
            >
              <Send className="w-4 h-4" />
              <span>
                {launching
                  ? 'Dispatching...'
                  : `Send Broadcast (${effectiveSelected.length})`}
              </span>
            </button>
          </div>
        </div>

        {/* Live Preview */}
        <div className="xl:col-span-5 rounded-2xl border border-[#D4AF37]/25 bg-[#140A0D] p-6 space-y-4">
          <h3 className="font-display text-base font-semibold text-[#FAF7F2]">
            Message Preview
          </h3>
          <div className="rounded-xl border border-white/10 bg-[#0B0608] p-5 space-y-3">
            <div className="flex items-center justify-between text-xs text-[#9C8B86] border-b border-white/5 pb-2">
              <span>{activeBot ? activeBot.name : 'Select a bot'}</span>
              <span>{activeBot ? activeBot.platform.toUpperCase() : '—'}</span>
            </div>
            <div className="rounded-xl bg-gradient-to-br from-[#7F1D1D] to-[#991B1B] border border-[#D4AF37]/30 p-4 space-y-2.5 text-sm text-white">
              {messageType === 'image' && mediaUrl && (
                <img
                  src={mediaUrl}
                  alt="Preview"
                  referrerPolicy="no-referrer"
                  className="rounded-lg max-h-48 w-auto object-contain"
                />
              )}
              {messageType === 'audio' && mediaUrl && (
                <audio controls src={mediaUrl} className="w-full h-9" />
              )}
              {messageType === 'file' && mediaUrl && (
                <div className="flex items-center gap-2 text-xs text-[#FDE68A]">
                  <Paperclip className="w-4 h-4" />
                  <span>{fileName || 'Document Attachment'}</span>
                </div>
              )}
              <p className="whitespace-pre-wrap break-words">
                {text || (messageType === 'text' ? 'Your message preview appears here...' : '')}
              </p>
            </div>
            <div className="flex items-center justify-between text-xs text-[#9C8B86] tabular-nums">
              <span className="inline-flex items-center gap-1.5">
                <Users className="w-3.5 h-3.5 text-[#D4AF37]" />
                {effectiveSelected.length} recipients
              </span>
              <span>Rate limit: {settings.broadcastRateLimitMs}ms / msg</span>
            </div>
          </div>
        </div>
      </div>

      {/* Broadcast History */}
      <div className="rounded-2xl border border-[#D4AF37]/25 bg-[#140A0D] p-6 space-y-4">
        <h3 className="font-display text-base font-semibold text-[#FAF7F2]">
          Broadcast History & Delivery Progress
        </h3>
        {broadcasts.length === 0 ? (
          <p className="text-xs text-[#9C8B86]">No broadcast campaigns recorded yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-white/10 text-[#9C8B86]">
                  <th className="py-2.5 pr-4 font-medium">Campaign</th>
                  <th className="py-2.5 pr-4 font-medium">Channel</th>
                  <th className="py-2.5 pr-4 font-medium">Progress</th>
                  <th className="py-2.5 pr-4 font-medium text-right">Success</th>
                  <th className="py-2.5 pr-4 font-medium text-right">Failed</th>
                  <th className="py-2.5 pr-4 font-medium">Status</th>
                  <th className="py-2.5 font-medium text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {broadcasts.map((bc) => {
                  const done = bc.successCount + bc.failedCount;
                  const pct =
                    bc.totalTargets > 0
                      ? Math.round((done / bc.totalTargets) * 100)
                      : 0;
                  return (
                    <tr key={bc.id} className="hover:bg-white/[0.02]">
                      <td className="py-3 pr-4 font-medium text-[#FAF7F2]">
                        {bc.title}
                      </td>
                      <td className="py-3 pr-4 text-[#C7B7B2]">
                        {bc.platform} · {bc.messageType}
                      </td>
                      <td className="py-3 pr-4 w-44">
                        <div className="flex items-center gap-2">
                          <div className="flex-1 h-1.5 rounded-full bg-white/10 overflow-hidden">
                            <div
                              className="h-full bg-gradient-to-r from-[#DC2626] to-[#F59E0B]"
                              style={{ width: `${pct}%` }}
                            />
                          </div>
                          <span className="font-mono tabular-nums text-[11px] text-[#B8A8A3]">
                            {pct}%
                          </span>
                        </div>
                      </td>
                      <td className="py-3 pr-4 text-right font-mono tabular-nums text-emerald-400">
                        {bc.successCount}
                      </td>
                      <td className="py-3 pr-4 text-right font-mono tabular-nums text-red-400">
                        {bc.failedCount}
                      </td>
                      <td className="py-3 pr-4">
                        <span
                          className={`font-medium ${
                            bc.status === 'completed'
                              ? 'text-emerald-400'
                              : bc.status === 'running'
                              ? 'text-[#FDE68A]'
                              : bc.status === 'cancelled'
                              ? 'text-amber-400'
                              : 'text-red-400'
                          }`}
                        >
                          {bc.status}
                        </span>
                      </td>
                      <td className="py-3 text-right">
                        {bc.status === 'running' && (
                          <button
                            type="button"
                            onClick={() => handleCancelBroadcast(bc.id)}
                            className="inline-flex items-center gap-1 rounded border border-red-500/40 px-2.5 py-1 text-[11px] text-red-300 hover:bg-red-950/50 cursor-pointer"
                          >
                            <StopCircle className="w-3.5 h-3.5" />
                            Stop
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Confirmation Modal */}
      {confirmOpen && (
        <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4">
          <div className="max-w-md w-full rounded-2xl border border-[#D4AF37]/40 bg-[#140A0D] p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h4 className="font-display text-base font-semibold text-[#FAF7F2]">
                Confirm Broadcast Delivery
              </h4>
              <button
                type="button"
                onClick={() => setConfirmOpen(false)}
                className="text-[#9C8B86] hover:text-white cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <p className="text-xs text-[#C7B7B2] leading-relaxed">
              Send this {messageType} broadcast via <strong>{activeBot?.name}</strong> to{' '}
              <strong className="tabular-nums">{effectiveSelected.length}</strong> real subscribed customers?
            </p>
            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setConfirmOpen(false)}
                className="px-4 py-2 rounded-lg border border-white/10 text-xs text-[#C7B7B2] hover:bg-white/5 cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={launchBroadcast}
                className="px-4 py-2 rounded-lg bg-gradient-to-r from-[#991B1B] to-[#D97706] text-xs font-semibold text-white hover:brightness-110 cursor-pointer"
              >
                Confirm & Send
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
