import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { onAuthStateChanged, type User } from 'firebase/auth';
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  increment,
  limit,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
} from 'firebase/firestore';
import {
  auth,
  db,
  handleFirestoreError,
  OperationType,
} from '../lib/firebase';
import { authFetch, parseApiJson } from '../lib/apiClient';
import { audioNotifier } from '../lib/audioNotifier';
import type {
  AppSettingsRecord,
  BotRecord,
  BroadcastRecord,
  CustomerRecord,
  ErrorLogRecord,
  FlowRecord,
  MessageRecord,
  Platform,
} from '../types';

export const WORKSPACE_UID = 'forever_bot_workspace';

interface PendingSyncEvent {
  id: string;
  type: 'incoming_message' | 'outgoing_message' | 'customer_upsert' | 'error_log' | 'flow_executed';
  payload: Record<string, unknown>;
  createdAtIso: string;
}

interface StoreContextValue {
  user: User | null;
  workspaceUid: string;
  bots: BotRecord[];
  customers: CustomerRecord[];
  messages: MessageRecord[];
  broadcasts: BroadcastRecord[];
  flows: FlowRecord[];
  settings: AppSettingsRecord;
  errorLogs: ErrorLogRecord[];
  wsConnected: boolean;
  audioUnlocked: boolean;
  unlockAudio: () => Promise<boolean>;
  upsertBot: (bot: BotRecord, isNew: boolean) => Promise<void>;
  deleteBot: (botId: string) => Promise<void>;
  renameCustomer: (customerId: string, displayName: string) => Promise<void>;
  markCustomerRead: (customerId: string) => Promise<void>;
  saveMessage: (msg: MessageRecord) => Promise<void>;
  createBroadcast: (bc: BroadcastRecord) => Promise<void>;
  saveFlow: (flow: FlowRecord, isNew: boolean) => Promise<void>;
  toggleFlowActive: (flowId: string, isActive: boolean) => Promise<void>;
  deleteFlow: (flowId: string) => Promise<void>;
  saveSettings: (partial: Partial<AppSettingsRecord>) => Promise<void>;
  logError: (
    source: ErrorLogRecord['source'],
    message: string,
    details?: string,
    botId?: string,
    severity?: ErrorLogRecord['severity']
  ) => Promise<void>;
  clearErrorLog: (logId: string) => Promise<void>;
}

const DEFAULT_SETTINGS: AppSettingsRecord = {
  id: `settings_${WORKSPACE_UID}`,
  ownerUid: WORKSPACE_UID,
  soundEnabled: true,
  volume: 90,
  viberTone: 'royal_chime',
  telegramTone: 'gold_pulse',
  browserNotificationsEnabled: false,
  platformName: 'FOREVER BOT',
  defaultWebhookBaseUrl: typeof window !== 'undefined' ? window.location.origin : '',
  broadcastRateLimitMs: 180,
  broadcastRequireConfirm: true,
};

const StoreContext = createContext<StoreContextValue | null>(null);

export const StoreProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [authReady, setAuthReady] = useState(false);

  const [bots, setBots] = useState<BotRecord[]>([]);
  const [customers, setCustomers] = useState<CustomerRecord[]>([]);
  const [messages, setMessages] = useState<MessageRecord[]>([]);
  const [broadcasts, setBroadcasts] = useState<BroadcastRecord[]>([]);
  const [flows, setFlows] = useState<FlowRecord[]>([]);
  const [settings, setSettings] = useState<AppSettingsRecord>(DEFAULT_SETTINGS);
  const [errorLogs, setErrorLogs] = useState<ErrorLogRecord[]>([]);
  const [wsConnected, setWsConnected] = useState(false);
  const [audioUnlocked, setAudioUnlocked] = useState(false);

  const workspaceUid = user?.uid || WORKSPACE_UID;

  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  const customersRef = useRef(customers);
  customersRef.current = customers;
  const botsRef = useRef(bots);
  botsRef.current = bots;
  const flowsRef = useRef(flows);
  flowsRef.current = flows;
  const workspaceUidRef = useRef(workspaceUid);
  workspaceUidRef.current = workspaceUid;
  const initialMessagesLoadedRef = useRef(false);
  const soundedMessageIdsRef = useRef<Set<string>>(new Set());
  const telegramOffsetsRef = useRef<Record<string, number>>({});

  const unlockAudio = useCallback(async () => {
    const ok = await audioNotifier.unlockAudio();
    setAudioUnlocked(ok);
    return ok;
  }, []);

  // Auto-unlock Web Audio on first user interaction anywhere in app
  useEffect(() => {
    const handlePointer = () => {
      if (!audioNotifier.isUnlocked()) {
        audioNotifier.unlockAudio().then((ok) => {
          if (ok) setAudioUnlocked(true);
        });
      }
    };
    window.addEventListener('pointerdown', handlePointer, { passive: true });
    return () => window.removeEventListener('pointerdown', handlePointer);
  }, []);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => {
      setUser(u);
      setAuthReady(true);
    });
    return () => unsub();
  }, []);

  const persistPendingSyncEvent = useCallback(
    async (evt: PendingSyncEvent, playSound: boolean) => {
      const p = evt.payload;
      const ownerUid = String(p.ownerUid || workspaceUidRef.current);

      if (evt.type === 'incoming_message') {
        const customerId = String(p.customerId);
        const botId = String(p.botId);
        const platform = p.platform as Platform;
        const platformUserId = String(p.platformUserId);
        const platformName = String(p.platformName || 'Customer');
        const text = String(p.text || '');
        const timestampIso = String(p.timestampIso || new Date().toISOString());

        const custRef = doc(db, 'customers', customerId);
        const existingCustomer = customersRef.current.find((c) => c.id === customerId);

        if (!existingCustomer) {
          const snap = await getDoc(custRef);
          if (!snap.exists()) {
            await setDoc(custRef, {
              id: customerId,
              ownerUid,
              botId,
              platform,
              platformUserId,
              platformName,
              displayName: platformName,
              avatarUrl: String(p.avatarUrl || ''),
              username: String(p.username || ''),
              isSubscribed: true,
              lastMessageText: text.slice(0, 1900),
              lastMessageAt: timestampIso,
              unreadCount: 1,
              firstContactAt: timestampIso,
              createdAt: serverTimestamp(),
              updatedAt: serverTimestamp(),
            });
          } else {
            await updateDoc(custRef, {
              platformName,
              avatarUrl: String(p.avatarUrl || ''),
              username: String(p.username || ''),
              isSubscribed: true,
              lastMessageText: text.slice(0, 1900),
              lastMessageAt: timestampIso,
              unreadCount: increment(1),
              updatedAt: serverTimestamp(),
            });
          }
        } else {
          await updateDoc(custRef, {
            platformName,
            avatarUrl: String(p.avatarUrl || ''),
            username: String(p.username || ''),
            isSubscribed: true,
            lastMessageText: text.slice(0, 1900),
            lastMessageAt: timestampIso,
            unreadCount: increment(1),
            updatedAt: serverTimestamp(),
          });
        }

        const msgId = String(p.messageId);
        await setDoc(doc(db, 'messages', msgId), {
          id: msgId,
          ownerUid,
          customerId,
          botId,
          platform,
          platformUserId,
          platformMessageId: String(p.platformMessageId || ''),
          direction: 'incoming',
          senderType: 'customer',
          messageType: (p.messageType as MessageRecord['messageType']) || 'text',
          text: text.slice(0, 4000),
          mediaUrl: String(p.mediaUrl || ''),
          fileName: String(p.fileName || ''),
          status: 'received',
          errorMessage: '',
          timestampIso,
          createdAt: serverTimestamp(),
        });

        if (playSound && settingsRef.current.soundEnabled) {
          soundedMessageIdsRef.current.add(msgId);
          const tone =
            platform === 'viber'
              ? settingsRef.current.viberTone
              : settingsRef.current.telegramTone;
          audioNotifier.playNotification(platform, settingsRef.current.volume, tone);
          if (settingsRef.current.browserNotificationsEnabled) {
            audioNotifier.sendBrowserNotification(
              `FOREVER BOT · ${platform === 'viber' ? 'Viber' : 'Telegram'} (${platformName})`,
              text.slice(0, 140)
            );
          }
        }
      } else if (evt.type === 'outgoing_message') {
        const msgId = String(p.messageId);
        await setDoc(doc(db, 'messages', msgId), {
          id: msgId,
          ownerUid,
          customerId: String(p.customerId),
          botId: String(p.botId),
          platform: p.platform as Platform,
          platformUserId: String(p.platformUserId),
          platformMessageId: String(p.platformMessageId || ''),
          direction: 'outgoing',
          senderType: (p.senderType as MessageRecord['senderType']) || 'flow',
          messageType: (p.messageType as MessageRecord['messageType']) || 'text',
          text: String(p.text || '').slice(0, 4000),
          mediaUrl: String(p.mediaUrl || ''),
          fileName: String(p.fileName || ''),
          status: (p.status as MessageRecord['status']) || 'sent',
          errorMessage: String(p.errorMessage || ''),
          timestampIso: String(p.timestampIso || new Date().toISOString()),
          createdAt: serverTimestamp(),
        });
      } else if (evt.type === 'flow_executed') {
        const flowId = String(p.flowId);
        const flowRef = doc(db, 'flows', flowId);
        await updateDoc(flowRef, {
          executionCount: increment(1),
          lastExecutedAt: String(p.executedAt || new Date().toISOString()),
          updatedAt: serverTimestamp(),
        }).catch(() => {});
      } else if (evt.type === 'error_log') {
        const logId = `err_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
        await setDoc(doc(db, 'error_logs', logId), {
          id: logId,
          ownerUid,
          source: (p.source as ErrorLogRecord['source']) || 'system',
          botId: String(p.botId || ''),
          severity: (p.severity as ErrorLogRecord['severity']) || 'error',
          message: String(p.message || 'Unknown error').slice(0, 500),
          details: String(p.details || '').slice(0, 2000),
          createdAt: serverTimestamp(),
        });
      }
    },
    []
  );

  // Immediate Firestore real-time listeners (no blocking Google login)
  useEffect(() => {
    if (!authReady) return;
    const isSuper = user?.email === 'ultraspin168@gmail.com';
    const scopeFilter = isSuper ? [] : [where('ownerUid', '==', workspaceUid)];

    const unsubBots = onSnapshot(
      query(collection(db, 'bots'), ...scopeFilter),
      (snap) => {
        setBots(snap.docs.map((d) => d.data() as BotRecord));
      },
      (err) => handleFirestoreError(err, OperationType.LIST, 'bots')
    );

    const unsubCustomers = onSnapshot(
      query(collection(db, 'customers'), ...scopeFilter),
      (snap) => {
        const list = snap.docs.map((d) => d.data() as CustomerRecord);
        list.sort((a, b) =>
          (b.lastMessageAt || b.firstContactAt || '').localeCompare(
            a.lastMessageAt || a.firstContactAt || ''
          )
        );
        setCustomers(list);
      },
      (err) => handleFirestoreError(err, OperationType.LIST, 'customers')
    );

    const unsubMessages = onSnapshot(
      query(
        collection(db, 'messages'),
        ...scopeFilter,
        orderBy('createdAt', 'desc'),
        limit(400)
      ),
      (snap) => {
        const list = snap.docs.map((d) => d.data() as MessageRecord).reverse();
        if (!initialMessagesLoadedRef.current) {
          for (const m of list) {
            soundedMessageIdsRef.current.add(m.id);
          }
          initialMessagesLoadedRef.current = true;
        } else {
          for (const change of snap.docChanges()) {
            if (change.type === 'added') {
              const m = change.doc.data() as MessageRecord;
              if (
                m.direction === 'incoming' &&
                !soundedMessageIdsRef.current.has(m.id)
              ) {
                soundedMessageIdsRef.current.add(m.id);
                if (settingsRef.current.soundEnabled) {
                  const tone =
                    m.platform === 'viber'
                      ? settingsRef.current.viberTone
                      : settingsRef.current.telegramTone;
                  audioNotifier.playNotification(
                    m.platform,
                    settingsRef.current.volume,
                    tone
                  );
                  if (settingsRef.current.browserNotificationsEnabled) {
                    const cust = customersRef.current.find((c) => c.id === m.customerId);
                    audioNotifier.sendBrowserNotification(
                      `FOREVER BOT · ${m.platform === 'viber' ? 'Viber' : 'Telegram'} (${cust?.displayName || 'Customer'})`,
                      (m.text || '').slice(0, 140)
                    );
                  }
                }
              }
            }
          }
        }
        setMessages(list);
      },
      (err) => handleFirestoreError(err, OperationType.LIST, 'messages')
    );

    const unsubBroadcasts = onSnapshot(
      query(
        collection(db, 'broadcasts'),
        ...scopeFilter,
        orderBy('createdAt', 'desc'),
        limit(100)
      ),
      (snap) => {
        setBroadcasts(snap.docs.map((d) => d.data() as BroadcastRecord));
      },
      (err) => handleFirestoreError(err, OperationType.LIST, 'broadcasts')
    );

    const unsubFlows = onSnapshot(
      query(collection(db, 'flows'), ...scopeFilter),
      (snap) => {
        setFlows(snap.docs.map((d) => d.data() as FlowRecord));
      },
      (err) => handleFirestoreError(err, OperationType.LIST, 'flows')
    );

    const settingsId = `settings_${workspaceUid.replace(/[^a-zA-Z0-9_\-]/g, '_')}`;
    const unsubSettings = onSnapshot(
      doc(db, 'settings', settingsId),
      (snap) => {
        if (snap.exists()) {
          setSettings({ ...DEFAULT_SETTINGS, ...(snap.data() as AppSettingsRecord) });
        } else {
          setSettings({ ...DEFAULT_SETTINGS, id: settingsId, ownerUid: workspaceUid });
        }
      },
      (err) => handleFirestoreError(err, OperationType.GET, `settings/${settingsId}`)
    );

    const unsubErrorLogs = onSnapshot(
      query(
        collection(db, 'error_logs'),
        ...scopeFilter,
        orderBy('createdAt', 'desc'),
        limit(100)
      ),
      (snap) => {
        setErrorLogs(snap.docs.map((d) => d.data() as ErrorLogRecord));
      },
      (err) => handleFirestoreError(err, OperationType.LIST, 'error_logs')
    );

    return () => {
      unsubBots();
      unsubCustomers();
      unsubMessages();
      unsubBroadcasts();
      unsubFlows();
      unsubSettings();
      unsubErrorLogs();
    };
  }, [authReady, user?.email, workspaceUid]);

  // Bootstrap server vault from Firestore on load/redeploy
  useEffect(() => {
    if (!authReady) return;
    const timer = setTimeout(async () => {
      try {
        const res = await authFetch('/api/sync/bootstrap', {
          method: 'POST',
          body: JSON.stringify({ bots: botsRef.current, flows: flowsRef.current }),
        });
        if (!res.ok) return;
        const data = await parseApiJson<{
          ok: boolean;
          pendingEvents?: PendingSyncEvent[];
        }>(res);
        if (data.pendingEvents && data.pendingEvents.length > 0) {
          const ackIds: string[] = [];
          for (const evt of data.pendingEvents) {
            try {
              await persistPendingSyncEvent(evt, false);
              ackIds.push(evt.id);
            } catch (e) {
              console.error('Failed persisting pending event:', e);
            }
          }
          if (ackIds.length > 0) {
            await authFetch('/api/sync/ack', {
              method: 'POST',
              body: JSON.stringify({ eventIds: ackIds }),
            });
          }
        }
      } catch (err) {
        console.warn('Bootstrap sync notice:', err);
      }
    }, 500);
    return () => clearTimeout(timer);
  }, [authReady, bots.length, persistPendingSyncEvent]);

  // Real-time WebSocket connection (gracefully stops retries on serverless platforms like Vercel)
  useEffect(() => {
    if (!authReady) return;
    let ws: WebSocket | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let disposed = false;
    let failedWithoutOpen = 0;

    const connect = async () => {
      if (disposed) return;
      try {
        const token = user ? await user.getIdToken() : '';
        const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const qs = token ? `?token=${encodeURIComponent(token)}` : '';
        ws = new WebSocket(`${proto}//${window.location.host}/ws${qs}`);
        let didOpen = false;

        ws.onopen = () => {
          didOpen = true;
          failedWithoutOpen = 0;
          setWsConnected(true);
        };
        ws.onclose = () => {
          setWsConnected(false);
          if (disposed) return;
          if (!didOpen) {
            failedWithoutOpen += 1;
          }
          if (failedWithoutOpen >= 2) {
            // Serverless host (e.g. Vercel): rely on Firestore real-time onSnapshot + /api/sync/poll
            return;
          }
          reconnectTimer = setTimeout(connect, 3000);
        };
        ws.onmessage = async (event) => {
          try {
            const msg = JSON.parse(event.data) as {
              type: string;
              syncEventId?: string;
              data?: Record<string, unknown>;
            };

            if (msg.type === 'inbox:incoming' && msg.data) {
              await persistPendingSyncEvent(
                {
                  id: msg.syncEventId || '',
                  type: 'incoming_message',
                  payload: msg.data,
                  createdAtIso: new Date().toISOString(),
                },
                true
              );
              if (msg.syncEventId) {
                authFetch('/api/sync/ack', {
                  method: 'POST',
                  body: JSON.stringify({ eventIds: [msg.syncEventId] }),
                }).catch(() => {});
              }
            } else if (msg.type === 'inbox:outgoing' && msg.data) {
              await persistPendingSyncEvent(
                {
                  id: msg.syncEventId || '',
                  type: 'outgoing_message',
                  payload: msg.data,
                  createdAtIso: new Date().toISOString(),
                },
                false
              );
              if (msg.syncEventId) {
                authFetch('/api/sync/ack', {
                  method: 'POST',
                  body: JSON.stringify({ eventIds: [msg.syncEventId] }),
                }).catch(() => {});
              }
            } else if (msg.type === 'broadcast:progress' && msg.data) {
              const d = msg.data;
              const broadcastId = String(d.broadcastId);
              if (d.messagePayload) {
                await persistPendingSyncEvent(
                  {
                    id: msg.syncEventId || '',
                    type: 'outgoing_message',
                    payload: d.messagePayload as Record<string, unknown>,
                    createdAtIso: new Date().toISOString(),
                  },
                  false
                );
                if (msg.syncEventId) {
                  authFetch('/api/sync/ack', {
                    method: 'POST',
                    body: JSON.stringify({ eventIds: [msg.syncEventId] }),
                  }).catch(() => {});
                }
              }
              const bcRef = doc(db, 'broadcasts', broadcastId);
              const updatePayload: Record<string, unknown> = {
                successCount: Number(d.successCount || 0),
                failedCount: Number(d.failedCount || 0),
                status: String(d.status || 'running'),
                updatedAt: serverTimestamp(),
              };
              if (d.completedAt) {
                updatePayload.completedAt = String(d.completedAt);
              }
              await updateDoc(bcRef, updatePayload).catch(() => {});
            } else if (msg.type === 'flow:executed' && msg.data) {
              await persistPendingSyncEvent(
                {
                  id: msg.syncEventId || '',
                  type: 'flow_executed',
                  payload: msg.data,
                  createdAtIso: new Date().toISOString(),
                },
                false
              );
              if (msg.syncEventId) {
                authFetch('/api/sync/ack', {
                  method: 'POST',
                  body: JSON.stringify({ eventIds: [msg.syncEventId] }),
                }).catch(() => {});
              }
            } else if (msg.type === 'system:error_log' && msg.data) {
              await persistPendingSyncEvent(
                {
                  id: msg.syncEventId || '',
                  type: 'error_log',
                  payload: msg.data,
                  createdAtIso: new Date().toISOString(),
                },
                false
              );
            }
          } catch (err) {
            console.error('WebSocket message handling error:', err);
          }
        };
      } catch {
        if (!disposed) {
          reconnectTimer = setTimeout(connect, 4000);
        }
      }
    };

    connect();
    return () => {
      disposed = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      ws?.close();
    };
  }, [authReady, user, persistPendingSyncEvent]);

  // Serverless Telegram polling fallback when WebSocket is not connected (e.g., on Vercel)
  useEffect(() => {
    if (!authReady || wsConnected) return;
    let active = true;
    let inFlight = false;

    const timer = setInterval(async () => {
      if (!active || inFlight) return;
      const pollingBots = botsRef.current.filter(
        (b) =>
          b.platform === 'telegram' &&
          b.status === 'connected' &&
          b.syncMode === 'polling' &&
          b.encryptedToken
      );
      if (pollingBots.length === 0) return;

      inFlight = true;
      try {
        const res = await authFetch('/api/sync/poll', {
          method: 'POST',
          body: JSON.stringify({
            bots: pollingBots,
            flows: flowsRef.current,
            offsets: telegramOffsetsRef.current,
          }),
        });
        if (res.ok) {
          const data = await parseApiJson<{
            ok?: boolean;
            offsets?: Record<string, number>;
          }>(res);
          if (data.offsets) {
            telegramOffsetsRef.current = {
              ...telegramOffsetsRef.current,
              ...data.offsets,
            };
          }
        }
      } catch {
        // Ignore transient network poll errors
      } finally {
        inFlight = false;
      }
    }, 4000);

    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [authReady, wsConnected]);

  // CRUD methods
  const upsertBot = useCallback(async (bot: BotRecord, isNew: boolean) => {
    const uid = workspaceUidRef.current;
    const botRef = doc(db, 'bots', bot.id);
    try {
      if (isNew) {
        await setDoc(botRef, {
          id: bot.id,
          ownerUid: uid,
          name: bot.name.slice(0, 100),
          platform: bot.platform,
          status: bot.status,
          encryptedToken: bot.encryptedToken || '',
          tokenMasked: bot.tokenMasked || '',
          botUsername: bot.botUsername || '',
          botPlatformId: bot.botPlatformId || '',
          webhookUrl: bot.webhookUrl || '',
          webhookStatus: bot.webhookStatus || 'unset',
          syncMode: bot.syncMode || (bot.platform === 'viber' ? 'webhook' : 'polling'),
          lastSyncAt: bot.lastSyncAt || '',
          lastError: bot.lastError || '',
          permissions: bot.permissions || {
            allowBroadcast: true,
            allowFlows: true,
            allowMedia: true,
            autoCreateCustomer: true,
          },
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      } else {
        await updateDoc(botRef, {
          name: bot.name.slice(0, 100),
          status: bot.status,
          encryptedToken: bot.encryptedToken || '',
          tokenMasked: bot.tokenMasked || '',
          botUsername: bot.botUsername || '',
          botPlatformId: bot.botPlatformId || '',
          webhookUrl: bot.webhookUrl || '',
          webhookStatus: bot.webhookStatus || 'unset',
          syncMode: bot.syncMode || (bot.platform === 'viber' ? 'webhook' : 'polling'),
          lastSyncAt: bot.lastSyncAt || '',
          lastError: bot.lastError || '',
          permissions: bot.permissions || {
            allowBroadcast: true,
            allowFlows: true,
            allowMedia: true,
            autoCreateCustomer: true,
          },
          updatedAt: serverTimestamp(),
        });
      }
    } catch (err) {
      handleFirestoreError(err, isNew ? OperationType.CREATE : OperationType.UPDATE, `bots/${bot.id}`);
    }
  }, []);

  const deleteBot = useCallback(async (botId: string) => {
    try {
      await authFetch(`/api/bots/${encodeURIComponent(botId)}`, { method: 'DELETE' }).catch(() => {});
      await deleteDoc(doc(db, 'bots', botId));
    } catch (err) {
      handleFirestoreError(err, OperationType.DELETE, `bots/${botId}`);
    }
  }, []);

  const renameCustomer = useCallback(async (customerId: string, displayName: string) => {
    const clean = displayName.trim().slice(0, 160);
    if (!clean) return;
    try {
      await updateDoc(doc(db, 'customers', customerId), {
        displayName: clean,
        updatedAt: serverTimestamp(),
      });
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `customers/${customerId}`);
    }
  }, []);

  const markCustomerRead = useCallback(async (customerId: string) => {
    try {
      await updateDoc(doc(db, 'customers', customerId), {
        unreadCount: 0,
        updatedAt: serverTimestamp(),
      });
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `customers/${customerId}`);
    }
  }, []);

  const saveMessage = useCallback(async (msg: MessageRecord) => {
    const uid = workspaceUidRef.current;
    try {
      await setDoc(doc(db, 'messages', msg.id), {
        id: msg.id,
        ownerUid: uid,
        customerId: msg.customerId,
        botId: msg.botId,
        platform: msg.platform,
        platformUserId: msg.platformUserId,
        platformMessageId: msg.platformMessageId || '',
        direction: msg.direction,
        senderType: msg.senderType,
        messageType: msg.messageType,
        text: (msg.text || '').slice(0, 4000),
        mediaUrl: msg.mediaUrl || '',
        fileName: msg.fileName || '',
        status: msg.status,
        errorMessage: msg.errorMessage || '',
        timestampIso: msg.timestampIso || new Date().toISOString(),
        createdAt: serverTimestamp(),
      });

      await updateDoc(doc(db, 'customers', msg.customerId), {
        lastMessageText: (msg.text || `[${msg.messageType}]`).slice(0, 1900),
        lastMessageAt: msg.timestampIso || new Date().toISOString(),
        unreadCount: 0,
        updatedAt: serverTimestamp(),
      });
    } catch (err) {
      handleFirestoreError(err, OperationType.CREATE, `messages/${msg.id}`);
    }
  }, []);

  const createBroadcast = useCallback(async (bc: BroadcastRecord) => {
    const uid = workspaceUidRef.current;
    try {
      await setDoc(doc(db, 'broadcasts', bc.id), {
        id: bc.id,
        ownerUid: uid,
        title: bc.title.slice(0, 160),
        botId: bc.botId,
        platform: bc.platform,
        messageType: bc.messageType,
        text: (bc.text || '').slice(0, 4000),
        mediaUrl: bc.mediaUrl || '',
        dedupeKey: bc.dedupeKey || '',
        totalTargets: bc.totalTargets,
        successCount: bc.successCount,
        failedCount: bc.failedCount,
        status: bc.status,
        startedAt: bc.startedAt || new Date().toISOString(),
        completedAt: bc.completedAt || '',
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    } catch (err) {
      handleFirestoreError(err, OperationType.CREATE, `broadcasts/${bc.id}`);
    }
  }, []);

  const saveFlow = useCallback(async (flow: FlowRecord, isNew: boolean) => {
    const uid = workspaceUidRef.current;
    const flowRef = doc(db, 'flows', flow.id);
    try {
      if (isNew) {
        await setDoc(flowRef, {
          id: flow.id,
          ownerUid: uid,
          name: flow.name.slice(0, 120),
          botId: flow.botId,
          platform: flow.platform,
          isActive: flow.isActive,
          triggerKeywords: (flow.triggerKeywords || []).slice(0, 20),
          nodes: flow.nodes.slice(0, 50),
          edges: flow.edges.slice(0, 100),
          executionCount: flow.executionCount || 0,
          lastExecutedAt: flow.lastExecutedAt || '',
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      } else {
        await updateDoc(flowRef, {
          name: flow.name.slice(0, 120),
          botId: flow.botId,
          platform: flow.platform,
          isActive: flow.isActive,
          triggerKeywords: (flow.triggerKeywords || []).slice(0, 20),
          nodes: flow.nodes.slice(0, 50),
          edges: flow.edges.slice(0, 100),
          executionCount: flow.executionCount || 0,
          lastExecutedAt: flow.lastExecutedAt || '',
          updatedAt: serverTimestamp(),
        });
      }
      const nextFlows = isNew
        ? [...flowsRef.current, flow]
        : flowsRef.current.map((f) => (f.id === flow.id ? flow : f));
      authFetch('/api/sync/flows', {
        method: 'POST',
        body: JSON.stringify({ flows: nextFlows }),
      }).catch(() => {});
    } catch (err) {
      handleFirestoreError(err, isNew ? OperationType.CREATE : OperationType.UPDATE, `flows/${flow.id}`);
    }
  }, []);

  const toggleFlowActive = useCallback(async (flowId: string, isActive: boolean) => {
    try {
      await updateDoc(doc(db, 'flows', flowId), {
        isActive,
        updatedAt: serverTimestamp(),
      });
      const nextFlows = flowsRef.current.map((f) =>
        f.id === flowId ? { ...f, isActive } : f
      );
      authFetch('/api/sync/flows', {
        method: 'POST',
        body: JSON.stringify({ flows: nextFlows }),
      }).catch(() => {});
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `flows/${flowId}`);
    }
  }, []);

  const deleteFlow = useCallback(async (flowId: string) => {
    try {
      await deleteDoc(doc(db, 'flows', flowId));
      const nextFlows = flowsRef.current.filter((f) => f.id !== flowId);
      authFetch('/api/sync/flows', {
        method: 'POST',
        body: JSON.stringify({ flows: nextFlows }),
      }).catch(() => {});
    } catch (err) {
      handleFirestoreError(err, OperationType.DELETE, `flows/${flowId}`);
    }
  }, []);

  const saveSettings = useCallback(async (partial: Partial<AppSettingsRecord>) => {
    const uid = workspaceUidRef.current;
    const settingsId = `settings_${uid.replace(/[^a-zA-Z0-9_\-]/g, '_')}`;
    const merged = { ...settingsRef.current, ...partial };
    try {
      await setDoc(
        doc(db, 'settings', settingsId),
        {
          id: settingsId,
          ownerUid: uid,
          soundEnabled: merged.soundEnabled,
          volume: Math.min(Math.max(Math.round(merged.volume), 0), 100),
          viberTone: merged.viberTone,
          telegramTone: merged.telegramTone,
          browserNotificationsEnabled: merged.browserNotificationsEnabled,
          platformName: merged.platformName.slice(0, 100),
          defaultWebhookBaseUrl: merged.defaultWebhookBaseUrl.slice(0, 512),
          broadcastRateLimitMs: Math.min(Math.max(Math.round(merged.broadcastRateLimitMs), 80), 10000),
          broadcastRequireConfirm: merged.broadcastRequireConfirm,
          updatedAt: serverTimestamp(),
        },
        { merge: true }
      );
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, `settings/${settingsId}`);
    }
  }, []);

  const logError = useCallback(
    async (
      source: ErrorLogRecord['source'],
      message: string,
      details = '',
      botId = '',
      severity: ErrorLogRecord['severity'] = 'error'
    ) => {
      const uid = workspaceUidRef.current;
      const logId = `err_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
      try {
        await setDoc(doc(db, 'error_logs', logId), {
          id: logId,
          ownerUid: uid,
          source,
          botId,
          severity,
          message: message.slice(0, 500),
          details: details.slice(0, 2000),
          createdAt: serverTimestamp(),
        });
      } catch (err) {
        console.error('Failed to persist error log:', err);
      }
    },
    []
  );

  const clearErrorLog = useCallback(async (logId: string) => {
    try {
      await deleteDoc(doc(db, 'error_logs', logId));
    } catch (err) {
      handleFirestoreError(err, OperationType.DELETE, `error_logs/${logId}`);
    }
  }, []);

  const value = useMemo<StoreContextValue>(
    () => ({
      user,
      workspaceUid,
      bots,
      customers,
      messages,
      broadcasts,
      flows,
      settings,
      errorLogs,
      wsConnected,
      audioUnlocked,
      unlockAudio,
      upsertBot,
      deleteBot,
      renameCustomer,
      markCustomerRead,
      saveMessage,
      createBroadcast,
      saveFlow,
      toggleFlowActive,
      deleteFlow,
      saveSettings,
      logError,
      clearErrorLog,
    }),
    [
      user,
      workspaceUid,
      bots,
      customers,
      messages,
      broadcasts,
      flows,
      settings,
      errorLogs,
      wsConnected,
      audioUnlocked,
      unlockAudio,
      upsertBot,
      deleteBot,
      renameCustomer,
      markCustomerRead,
      saveMessage,
      createBroadcast,
      saveFlow,
      toggleFlowActive,
      deleteFlow,
      saveSettings,
      logError,
      clearErrorLog,
    ]
  );

  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
};

export function useStore() {
  const ctx = useContext(StoreContext);
  if (!ctx) throw new Error('useStore must be used within StoreProvider');
  return ctx;
}
