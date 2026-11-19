import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Search,
  Send,
  Image as ImageIcon,
  Music,
  Paperclip,
  Edit3,
  Check,
  X,
  Copy,
  AlertCircle,
  MessageSquare,
  ChevronUp,
} from 'lucide-react';
import { useStore } from '../context/StoreContext';
import { authFetch } from '../lib/apiClient';
import type { MessageRecord, MessageType, Platform } from '../types';

interface InboxPageProps {
  initialCustomerId?: string | null;
}

const PAGE_SIZE = 40;

export const InboxPage: React.FC<InboxPageProps> = ({ initialCustomerId }) => {
  const {
    bots,
    customers,
    messages,
    renameCustomer,
    markCustomerRead,
    saveMessage,
    logError,
  } = useStore();

  const [selectedCustomerId, setSelectedCustomerId] = useState<string | null>(
    initialCustomerId || null
  );
  const [searchTerm, setSearchTerm] = useState('');
  const [platformFilter, setPlatformFilter] = useState<'all' | Platform>('all');
  const [botFilter, setBotFilter] = useState<string>('all');

  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState('');
  const [copiedId, setCopiedId] = useState(false);

  const [replyText, setReplyText] = useState('');
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);

  const [pendingAttachment, setPendingAttachment] = useState<{
    messageType: MessageType;
    url: string;
    localPath: string;
    fileBase64?: string;
    fileName: string;
    fileSize: number;
  } | null>(null);
  const [uploading, setUploading] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const uploadTargetTypeRef = useRef<MessageType>('image');
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (initialCustomerId) {
      setSelectedCustomerId(initialCustomerId);
    }
  }, [initialCustomerId]);

  const filteredCustomers = useMemo(() => {
    const q = searchTerm.trim().toLowerCase();
    return customers.filter((c) => {
      if (platformFilter !== 'all' && c.platform !== platformFilter) return false;
      if (botFilter !== 'all' && c.botId !== botFilter) return false;
      if (!q) return true;
      return (
        c.displayName.toLowerCase().includes(q) ||
        (c.platformName || '').toLowerCase().includes(q) ||
        c.platformUserId.toLowerCase().includes(q) ||
        (c.lastMessageText || '').toLowerCase().includes(q)
      );
    });
  }, [customers, searchTerm, platformFilter, botFilter]);

  const activeCustomer = useMemo(
    () => customers.find((c) => c.id === selectedCustomerId) || null,
    [customers, selectedCustomerId]
  );

  const activeBot = useMemo(
    () => (activeCustomer ? bots.find((b) => b.id === activeCustomer.botId) || null : null),
    [bots, activeCustomer]
  );

  const customerMessages = useMemo(() => {
    if (!activeCustomer) return [];
    return messages.filter((m) => m.customerId === activeCustomer.id);
  }, [messages, activeCustomer]);

  const paginatedMessages = useMemo(() => {
    if (customerMessages.length <= visibleCount) return customerMessages;
    return customerMessages.slice(customerMessages.length - visibleCount);
  }, [customerMessages, visibleCount]);

  useEffect(() => {
    setVisibleCount(PAGE_SIZE);
    setEditingName(false);
    setSendError(null);
    if (activeCustomer && activeCustomer.unreadCount > 0) {
      markCustomerRead(activeCustomer.id).catch(() => {});
    }
  }, [activeCustomer?.id]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [customerMessages.length, activeCustomer?.id]);

  const handleSaveName = async () => {
    if (!activeCustomer || !nameDraft.trim()) return;
    await renameCustomer(activeCustomer.id, nameDraft.trim());
    setEditingName(false);
  };

  const handleCopyId = () => {
    if (!activeCustomer) return;
    navigator.clipboard.writeText(activeCustomer.platformUserId);
    setCopiedId(true);
    setTimeout(() => setCopiedId(false), 1800);
  };

  const triggerFilePicker = (type: MessageType) => {
    uploadTargetTypeRef.current = type;
    if (fileInputRef.current) {
      fileInputRef.current.accept =
        type === 'image'
          ? 'image/*'
          : type === 'audio'
          ? 'audio/*'
          : '*/*';
      fileInputRef.current.click();
    }
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setUploading(true);
    setSendError(null);
    try {
      const formData = new FormData();
      formData.append('file', file);
      const res = await authFetch('/api/upload', {
        method: 'POST',
        body: formData,
      });
      const json = (await res.json()) as {
        ok?: boolean;
        url?: string;
        localPath?: string;
        fileBase64?: string;
        fileName?: string;
        fileSize?: number;
        error?: string;
      };
      if (!res.ok || !json.url) {
        throw new Error(json.error || 'Upload failed');
      }
      setPendingAttachment({
        messageType: uploadTargetTypeRef.current,
        url: json.url,
        localPath: json.localPath || '',
        fileBase64: json.fileBase64 || '',
        fileName: json.fileName || file.name,
        fileSize: json.fileSize || file.size,
      });
    } catch (err) {
      setSendError(err instanceof Error ? err.message : 'Failed to upload attachment.');
    } finally {
      setUploading(false);
    }
  };

  const handleSendReply = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeCustomer || !activeBot) return;
    if (!replyText.trim() && !pendingAttachment) return;

    if (activeBot.status !== 'connected') {
      setSendError(
        `Bot "${activeBot.name}" is ${activeBot.status}. Connect the bot in Bot Management first.`
      );
      return;
    }

    if (pendingAttachment && activeBot.permissions?.allowMedia === false) {
      setSendError(`Media sending is disabled in "${activeBot.name}" permissions.`);
      return;
    }

    setSending(true);
    setSendError(null);

    const msgType: MessageType = pendingAttachment ? pendingAttachment.messageType : 'text';
    const textPayload = replyText.trim();

    try {
      const res = await authFetch('/api/messages/send', {
        method: 'POST',
        body: JSON.stringify({
          botId: activeBot.id,
          platform: activeBot.platform,
          botName: activeBot.name,
          encryptedToken: activeBot.encryptedToken,
          platformUserId: activeCustomer.platformUserId,
          messageType: msgType,
          text: textPayload,
          mediaUrl: pendingAttachment?.url,
          localFilePath: pendingAttachment?.localPath,
          fileBase64: pendingAttachment?.fileBase64,
          fileName: pendingAttachment?.fileName,
          fileSize: pendingAttachment?.fileSize,
        }),
      });
      const json = (await res.json()) as {
        ok: boolean;
        platformMessageId?: string;
        error?: string;
      };

      const msgId = `msg_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
      const record: MessageRecord = {
        id: msgId,
        ownerUid: activeCustomer.ownerUid,
        customerId: activeCustomer.id,
        botId: activeBot.id,
        platform: activeCustomer.platform,
        platformUserId: activeCustomer.platformUserId,
        platformMessageId: json.platformMessageId || '',
        direction: 'outgoing',
        senderType: 'admin',
        messageType: msgType,
        text: textPayload || (pendingAttachment ? `[${msgType}: ${pendingAttachment.fileName}]` : ''),
        mediaUrl: pendingAttachment?.url || '',
        fileName: pendingAttachment?.fileName || '',
        status: json.ok ? 'sent' : 'failed',
        errorMessage: json.error || '',
        timestampIso: new Date().toISOString(),
      };

      await saveMessage(record);

      if (!json.ok) {
        setSendError(json.error || 'Message failed to deliver.');
        await logError(
          activeBot.platform === 'viber' ? 'viber_api' : 'telegram_api',
          `Failed reply to ${activeCustomer.displayName}`,
          json.error || '',
          activeBot.id
        );
      } else {
        setReplyText('');
        setPendingAttachment(null);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to send reply';
      setSendError(message);
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="h-[calc(100vh-140px)] min-h-[540px] rounded-2xl border border-[#D4AF37]/25 bg-[#140A0D] overflow-hidden grid grid-cols-1 lg:grid-cols-12">
      {/* Left Conversation Directory */}
      <div
        className={`lg:col-span-4 border-b lg:border-b-0 lg:border-r border-white/10 flex flex-col min-h-0 ${
          activeCustomer ? 'hidden lg:flex' : 'flex'
        }`}
      >
        <div className="p-4 border-b border-white/10 space-y-3">
          <div className="relative">
            <Search className="w-4 h-4 text-[#9C8B86] absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="Search customer name or ID..."
              className="w-full rounded-lg border border-white/10 bg-[#0B0608] pl-9 pr-3 py-2 text-xs text-[#FAF7F2] placeholder-[#7D6C67] focus:border-[#D4AF37] focus:outline-none"
            />
          </div>

          <div className="flex items-center gap-2">
            <div className="flex items-center gap-1 p-1 rounded-lg bg-[#0B0608] border border-white/10">
              {(['all', 'viber', 'telegram'] as const).map((plat) => (
                <button
                  key={plat}
                  type="button"
                  onClick={() => setPlatformFilter(plat)}
                  className={`px-2.5 py-1 rounded-md text-xs font-medium transition cursor-pointer whitespace-nowrap ${
                    platformFilter === plat
                      ? 'bg-gradient-to-r from-[#991B1B] to-[#B45309] text-white'
                      : 'text-[#B8A8A3] hover:text-white'
                  }`}
                >
                  {plat === 'all' ? 'All' : plat === 'viber' ? 'Viber' : 'Telegram'}
                </button>
              ))}
            </div>

            <select
              value={botFilter}
              onChange={(e) => setBotFilter(e.target.value)}
              className="flex-1 min-w-0 rounded-lg border border-white/10 bg-[#0B0608] px-2.5 py-1.5 text-xs text-[#FAF7F2] focus:border-[#D4AF37] focus:outline-none"
            >
              <option value="all">All Bots</option>
              {bots.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto divide-y divide-white/5">
          {filteredCustomers.length === 0 ? (
            <div className="p-8 text-center space-y-2">
              <MessageSquare className="w-7 h-7 text-[#D4AF37]/50 mx-auto" />
              <p className="text-xs font-medium text-[#FAF7F2]">No conversations yet</p>
              <p className="text-xs text-[#9C8B86]">
                Real Viber and Telegram messages sent to your connected bots will appear here automatically.
              </p>
            </div>
          ) : (
            filteredCustomers.map((c) => {
              const bot = bots.find((b) => b.id === c.botId);
              const selected = c.id === activeCustomer?.id;
              return (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => setSelectedCustomerId(c.id)}
                  className={`w-full p-3.5 text-left transition flex items-start justify-between gap-3 cursor-pointer ${
                    selected
                      ? 'bg-gradient-to-r from-[#7F1D1D]/45 to-[#B45309]/20'
                      : 'hover:bg-white/[0.03]'
                  }`}
                >
                  <div className="flex items-start gap-3 min-w-0">
                    {c.avatarUrl ? (
                      <img
                        src={c.avatarUrl}
                        alt={c.displayName}
                        referrerPolicy="no-referrer"
                        className="w-9 h-9 rounded-full object-cover border border-[#D4AF37]/30 shrink-0"
                      />
                    ) : (
                      <div className="w-9 h-9 rounded-full bg-gradient-to-br from-[#991B1B] to-[#D4AF37] flex items-center justify-center text-xs font-bold text-white shrink-0">
                        {c.displayName.slice(0, 2).toUpperCase()}
                      </div>
                    )}
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-[#FAF7F2] truncate">
                        {c.displayName}
                      </p>
                      <p className="text-[11px] text-[#9C8B86] truncate">
                        {c.platform === 'viber' ? 'Viber' : 'Telegram'} · {bot?.name || c.botId}
                      </p>
                      <p className="text-xs text-[#C7B7B2] truncate mt-1">
                        {c.lastMessageText || 'No messages'}
                      </p>
                    </div>
                  </div>
                  <div className="shrink-0 text-right space-y-1">
                    {c.lastMessageAt && (
                      <p className="text-[11px] font-mono text-[#7D6C67] tabular-nums">
                        {new Date(c.lastMessageAt).toLocaleTimeString([], {
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </p>
                    )}
                    {c.unreadCount > 0 && (
                      <span className="inline-block text-[11px] font-bold text-[#FDE68A] bg-[#991B1B] px-1.5 py-0.5 rounded tabular-nums">
                        {c.unreadCount}
                      </span>
                    )}
                  </div>
                </button>
              );
            })
          )}
        </div>
      </div>

      {/* Right Chat Thread */}
      <div
        className={`lg:col-span-8 flex flex-col min-h-0 bg-[#0E0709] ${
          activeCustomer ? 'flex' : 'hidden lg:flex'
        }`}
      >
        {!activeCustomer ? (
          <div className="flex-1 flex flex-col items-center justify-center p-8 text-center space-y-2">
            <MessageSquare className="w-10 h-10 text-[#D4AF37]/40" />
            <h3 className="font-display text-lg font-semibold text-[#FAF7F2]">
              Select a Customer Conversation
            </h3>
            <p className="text-xs text-[#9C8B86] max-w-sm">
              Choose a conversation from the left directory to view full message history, edit display names, and send real Viber or Telegram replies.
            </p>
          </div>
        ) : (
          <>
            {/* Customer Profile Header */}
            <div className="p-4 border-b border-white/10 bg-[#140A0D] flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-3 min-w-0">
                <button
                  type="button"
                  onClick={() => setSelectedCustomerId(null)}
                  className="lg:hidden text-xs text-[#FDE68A] border border-[#D4AF37]/30 px-2.5 py-1 rounded-lg"
                >
                  Back
                </button>
                {activeCustomer.avatarUrl ? (
                  <img
                    src={activeCustomer.avatarUrl}
                    alt={activeCustomer.displayName}
                    referrerPolicy="no-referrer"
                    className="w-10 h-10 rounded-full object-cover border border-[#D4AF37]/40 shrink-0"
                  />
                ) : (
                  <div className="w-10 h-10 rounded-full bg-gradient-to-br from-[#991B1B] to-[#D4AF37] flex items-center justify-center text-xs font-bold text-white shrink-0">
                    {activeCustomer.displayName.slice(0, 2).toUpperCase()}
                  </div>
                )}

                <div className="min-w-0">
                  {editingName ? (
                    <div className="flex items-center gap-2">
                      <input
                        type="text"
                        value={nameDraft}
                        onChange={(e) => setNameDraft(e.target.value)}
                        className="rounded border border-[#D4AF37]/50 bg-[#0B0608] px-2.5 py-1 text-sm text-white focus:outline-none"
                        autoFocus
                      />
                      <button
                        type="button"
                        onClick={handleSaveName}
                        aria-label="Save name"
                        className="p-1.5 rounded bg-emerald-700/80 text-white hover:bg-emerald-600 cursor-pointer"
                      >
                        <Check className="w-3.5 h-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => setEditingName(false)}
                        aria-label="Cancel rename"
                        className="p-1.5 rounded bg-white/10 text-white hover:bg-white/20 cursor-pointer"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ) : (
                    <div className="flex items-center gap-2">
                      <h3 className="font-display text-base font-semibold text-[#FAF7F2] truncate">
                        {activeCustomer.displayName}
                      </h3>
                      <button
                        type="button"
                        onClick={() => {
                          setNameDraft(activeCustomer.displayName);
                          setEditingName(true);
                        }}
                        title="Edit display name (preserves platform ID)"
                        className="text-[#D4AF37] hover:text-[#FDE68A] cursor-pointer"
                      >
                        <Edit3 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  )}

                  <div className="flex flex-wrap items-center gap-2 text-xs text-[#9C8B86] mt-0.5">
                    <span>{activeCustomer.platform === 'viber' ? 'Viber' : 'Telegram'}</span>
                    <span aria-hidden="true">·</span>
                    <span>{activeBot?.name || activeCustomer.botId}</span>
                    <span aria-hidden="true">·</span>
                    <button
                      type="button"
                      onClick={handleCopyId}
                      className="inline-flex items-center gap-1 font-mono text-[11px] text-[#C7B7B2] hover:text-[#FDE68A] cursor-pointer"
                    >
                      <span>ID: {activeCustomer.platformUserId}</span>
                      <Copy className="w-3 h-3" />
                      {copiedId && <span className="text-emerald-400">Copied</span>}
                    </button>
                  </div>
                </div>
              </div>

              <div className="text-right text-xs text-[#9C8B86] tabular-nums">
                {activeCustomer.username && (
                  <p className="text-[#FDE68A] font-mono">{activeCustomer.username}</p>
                )}
                <p>
                  First contact:{' '}
                  {activeCustomer.firstContactAt
                    ? new Date(activeCustomer.firstContactAt).toLocaleDateString()
                    : '—'}
                </p>
              </div>
            </div>

            {/* Messages Timeline */}
            <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-4">
              {customerMessages.length > visibleCount && (
                <div className="text-center">
                  <button
                    type="button"
                    onClick={() => setVisibleCount((c) => c + PAGE_SIZE)}
                    className="inline-flex items-center gap-1.5 text-xs text-[#FDE68A] border border-[#D4AF37]/30 px-3 py-1.5 rounded-lg hover:bg-white/5 cursor-pointer"
                  >
                    <ChevronUp className="w-3.5 h-3.5" />
                    Load earlier messages ({customerMessages.length - visibleCount} remaining)
                  </button>
                </div>
              )}

              {paginatedMessages.map((m) => {
                const isOut = m.direction === 'outgoing';
                return (
                  <div
                    key={m.id}
                    className={`flex flex-col ${isOut ? 'items-end' : 'items-start'}`}
                  >
                    <div
                      className={`max-w-[82%] sm:max-w-[70%] rounded-2xl px-4 py-3 text-sm space-y-2 ${
                        isOut
                          ? 'bg-gradient-to-br from-[#7F1D1D] to-[#991B1B] text-white border border-[#D4AF37]/30'
                          : 'bg-[#190D11] text-[#FAF7F2] border border-white/10'
                      }`}
                    >
                      {m.messageType === 'image' && m.mediaUrl && (
                        <a
                          href={m.mediaUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="block overflow-hidden rounded-lg border border-white/10"
                        >
                          <img
                            src={m.mediaUrl}
                            alt={m.fileName || 'Attachment'}
                            referrerPolicy="no-referrer"
                            className="max-h-64 w-auto object-contain"
                          />
                        </a>
                      )}

                      {m.messageType === 'audio' && m.mediaUrl && (
                        <audio controls src={m.mediaUrl} className="max-w-full h-9" />
                      )}

                      {m.messageType === 'file' && m.mediaUrl && (
                        <a
                          href={m.mediaUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center gap-2 text-xs text-[#FDE68A] underline"
                        >
                          <Paperclip className="w-3.5 h-3.5" />
                          <span>{m.fileName || 'Download attachment'}</span>
                        </a>
                      )}

                      {m.text && <p className="whitespace-pre-wrap break-words leading-relaxed">{m.text}</p>}

                      {m.status === 'failed' && m.errorMessage && (
                        <p className="text-[11px] text-red-200 flex items-center gap-1">
                          <AlertCircle className="w-3 h-3 shrink-0" />
                          <span>{m.errorMessage}</span>
                        </p>
                      )}
                    </div>

                    <div className="mt-1 flex items-center gap-2 text-[11px] text-[#7D6C67] font-mono tabular-nums px-1">
                      <span>{m.senderType}</span>
                      <span aria-hidden="true">·</span>
                      <span>
                        {m.timestampIso
                          ? new Date(m.timestampIso).toLocaleTimeString([], {
                              hour: '2-digit',
                              minute: '2-digit',
                            })
                          : ''}
                      </span>
                      {isOut && (
                        <>
                          <span aria-hidden="true">·</span>
                          <span className={m.status === 'failed' ? 'text-red-400' : 'text-[#D4AF37]'}>
                            {m.status}
                          </span>
                        </>
                      )}
                    </div>
                  </div>
                );
              })}
              <div ref={messagesEndRef} />
            </div>

            {/* Reply Composer */}
            <form
              onSubmit={handleSendReply}
              className="p-4 border-t border-white/10 bg-[#140A0D] space-y-3"
            >
              {sendError && (
                <div className="rounded-lg border border-red-500/40 bg-red-950/40 px-3 py-2 text-xs text-red-200 flex items-center gap-2">
                  <AlertCircle className="w-4 h-4 shrink-0" />
                  <span>{sendError}</span>
                </div>
              )}

              {pendingAttachment && (
                <div className="flex items-center justify-between rounded-lg border border-[#D4AF37]/30 bg-[#0B0608] px-3 py-2 text-xs">
                  <span className="text-[#FDE68A] truncate">
                    Attached ({pendingAttachment.messageType}): {pendingAttachment.fileName}
                  </span>
                  <button
                    type="button"
                    onClick={() => setPendingAttachment(null)}
                    className="text-[#B8A8A3] hover:text-white cursor-pointer"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              )}

              <input
                ref={fileInputRef}
                type="file"
                className="hidden"
                onChange={handleFileChange}
              />

              <div className="flex items-end gap-2">
                <div className="flex items-center gap-1 shrink-0">
                  <button
                    type="button"
                    disabled={uploading}
                    onClick={() => triggerFilePicker('image')}
                    title="Attach image"
                    className="p-2.5 rounded-lg border border-white/10 bg-[#0B0608] text-[#D4AF37] hover:border-[#D4AF37]/50 transition cursor-pointer disabled:opacity-50"
                  >
                    <ImageIcon className="w-4 h-4" />
                  </button>
                  <button
                    type="button"
                    disabled={uploading}
                    onClick={() => triggerFilePicker('audio')}
                    title="Attach audio"
                    className="p-2.5 rounded-lg border border-white/10 bg-[#0B0608] text-[#D4AF37] hover:border-[#D4AF37]/50 transition cursor-pointer disabled:opacity-50"
                  >
                    <Music className="w-4 h-4" />
                  </button>
                  <button
                    type="button"
                    disabled={uploading}
                    onClick={() => triggerFilePicker('file')}
                    title="Attach file"
                    className="p-2.5 rounded-lg border border-white/10 bg-[#0B0608] text-[#D4AF37] hover:border-[#D4AF37]/50 transition cursor-pointer disabled:opacity-50"
                  >
                    <Paperclip className="w-4 h-4" />
                  </button>
                </div>

                <textarea
                  rows={1}
                  value={replyText}
                  onChange={(e) => setReplyText(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      handleSendReply(e);
                    }
                  }}
                  placeholder={
                    uploading
                      ? 'Uploading attachment...'
                      : `Reply to ${activeCustomer.displayName} via ${activeCustomer.platform}...`
                  }
                  className="flex-1 resize-none rounded-lg border border-white/10 bg-[#0B0608] px-3.5 py-2.5 text-sm text-[#FAF7F2] placeholder-[#7D6C67] focus:border-[#D4AF37] focus:outline-none"
                />

                <button
                  type="submit"
                  disabled={sending || uploading || (!replyText.trim() && !pendingAttachment)}
                  className="inline-flex items-center gap-2 rounded-lg bg-gradient-to-r from-[#991B1B] to-[#D97706] px-4 py-2.5 text-sm font-semibold text-white hover:brightness-110 transition disabled:opacity-40 cursor-pointer shrink-0 whitespace-nowrap"
                >
                  <Send className="w-4 h-4" />
                  <span>{sending ? 'Sending' : 'Send'}</span>
                </button>
              </div>
            </form>
          </>
        )}
      </div>
    </div>
  );
};
