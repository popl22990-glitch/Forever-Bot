import 'dotenv/config';
import express from 'express';
import fs from 'fs';
import os from 'os';
import path from 'path';
import crypto from 'crypto';
import multer from 'multer';
import {
  requireAuth,
  type AuthRequest,
} from './firebaseAuthMiddleware.ts';
import {
  buildCustomerId,
  decryptToken,
  encryptToken,
  maskToken,
  runtimeVault,
} from './cryptoVault.ts';
import {
  deleteTelegramWebhook,
  fetchTelegramUpdates,
  getTelegramFileStreamUrl,
  removeViberWebhook,
  sendTelegramMessage,
  sendViberMessage,
  setTelegramWebhook,
  setViberWebhook,
  testTelegramBot,
  testViberBot,
  verifyViberSignature,
} from './botApis.ts';
import { executeFlow } from './flowEngine.ts';
import {
  fetchActiveFlowsFromFirestore,
  fetchBotFromFirestore,
  persistErrorLogToFirestore,
  persistFlowExecutedToFirestore,
  persistIncomingMessageToFirestore,
  persistOutgoingMessageToFirestore,
  updateBroadcastProgressInFirestore,
} from './firestoreRest.ts';
import type { BotRecord, FlowRecord, MessageType } from '../types.ts';

export const IS_SERVERLESS = Boolean(
  process.env.VERCEL === '1' || process.env.AWS_LAMBDA_FUNCTION_NAME
);

const PORT = Number(process.env.PORT || 3000);
const UPLOAD_DIR = IS_SERVERLESS
  ? path.join(os.tmpdir(), 'forever-bot-uploads')
  : path.resolve(process.cwd(), '.data', 'uploads');

try {
  if (!fs.existsSync(UPLOAD_DIR)) {
    fs.mkdirSync(UPLOAD_DIR, { recursive: true });
  }
} catch {
  // Ignore if directory already exists or is temporarily unavailable
}

const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => {
      try {
        if (!fs.existsSync(UPLOAD_DIR)) {
          fs.mkdirSync(UPLOAD_DIR, { recursive: true });
        }
      } catch {
        // ignore
      }
      cb(null, UPLOAD_DIR);
    },
    filename: (_req, file, cb) => {
      const ext = path.extname(file.originalname).slice(0, 16);
      const safeName = `${Date.now()}_${crypto.randomBytes(6).toString('hex')}${ext}`;
      cb(null, safeName);
    },
  }),
  limits: { fileSize: 20 * 1024 * 1024 },
});

const recentBroadcastKeys = new Map<string, number>();

export interface AppRuntimeHooks {
  broadcastToClients?: (ownerUid: string, event: Record<string, unknown>) => void;
  hasActiveWsClient?: (ownerUid: string) => boolean;
  getWsClientCount?: () => number;
}

export function createApp(hooks: AppRuntimeHooks = {}) {
  const app = express();

  const broadcastToClients = hooks.broadcastToClients ?? (() => {});
  const hasActiveWsClient = hooks.hasActiveWsClient ?? (() => false);
  const getWsClientCount = hooks.getWsClientCount ?? (() => 0);

  // Handle serverless runtimes (e.g. Vercel) that pre-parse req.body
  app.use((req, _res, next) => {
    if (req.body !== undefined && typeof req.body === 'object' && !Buffer.isBuffer(req.body)) {
      (req as express.Request & { _body?: boolean })._body = true;
    }
    next();
  });

  // Capture raw body for Viber HMAC signature verification
  app.use(
    express.json({
      limit: '15mb',
      verify: (req, _res, buf) => {
        (req as express.Request & { rawBody?: string }).rawBody = buf.toString('utf8');
      },
    })
  );

  // Publicly serve uploaded media so Viber & Telegram servers can fetch attachments
  app.use('/uploads', express.static(UPLOAD_DIR));
  app.use('/api/uploads', express.static(UPLOAD_DIR));

  function resolvePublicBaseUrl(req?: express.Request): string {
    if (process.env.APP_URL && process.env.APP_URL.startsWith('http')) {
      return process.env.APP_URL.replace(/\/+$/, '');
    }
    if (req) {
      const proto = (req.headers['x-forwarded-proto'] as string) || req.protocol || 'https';
      const host = req.headers['x-forwarded-host'] || req.headers.host;
      if (host) return `${proto}://${host}`;
    }
    if (process.env.VERCEL_URL) {
      return `https://${process.env.VERCEL_URL}`;
    }
    return `http://localhost:${PORT}`;
  }

  async function resolveBotEntry(botId: string) {
    let entry = runtimeVault.getBot(botId);
    if (entry) return entry;

    const fsBot = await fetchBotFromFirestore(botId);
    if (fsBot && fsBot.encryptedToken) {
      try {
        const plain = decryptToken(fsBot.encryptedToken);
        runtimeVault.setBot(fsBot, plain);
        entry = runtimeVault.getBot(botId);
      } catch (err) {
        console.warn(`Failed decrypting Firestore bot ${botId}:`, err);
      }
    }
    return entry;
  }

  async function resolveFlowsForBot(bot: BotRecord): Promise<FlowRecord[]> {
    let flows = runtimeVault.getFlowsForBot(bot.id, bot.platform);
    if (flows.length === 0) {
      const remoteFlows = await fetchActiveFlowsFromFirestore(bot.ownerUid);
      if (remoteFlows.length > 0) {
        runtimeVault.syncFlows(remoteFlows);
        flows = runtimeVault.getFlowsForBot(bot.id, bot.platform);
      }
    }
    return flows;
  }

  async function processIncomingMessagePipeline(params: {
    bot: BotRecord;
    plainToken: string;
    platformUserId: string;
    platformName: string;
    username?: string;
    avatarUrl?: string;
    platformMessageId: string;
    messageType: MessageType;
    text: string;
    mediaUrl?: string;
    fileName?: string;
    timestampIso: string;
  }) {
    const {
      bot,
      plainToken,
      platformUserId,
      platformName,
      username,
      avatarUrl,
      platformMessageId,
      messageType,
      text,
      mediaUrl,
      fileName,
      timestampIso,
    } = params;

    const dedupeId = `${bot.platform}:${bot.id}:${platformMessageId}`;
    if (runtimeVault.hasProcessedMessage(dedupeId)) {
      return;
    }
    runtimeVault.markMessageProcessed(dedupeId);

    const customerId = buildCustomerId(bot.id, platformUserId);
    const messageId = `msg_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;

    const useDirectFirestore = IS_SERVERLESS || !hasActiveWsClient(bot.ownerUid);
    let persistedDirect = false;

    if (useDirectFirestore) {
      persistedDirect = await persistIncomingMessageToFirestore({
        ownerUid: bot.ownerUid,
        botId: bot.id,
        platform: bot.platform,
        customerId,
        platformUserId,
        platformName,
        username: username || '',
        avatarUrl: avatarUrl || '',
        messageId,
        platformMessageId,
        messageType,
        text,
        mediaUrl: mediaUrl || '',
        fileName: fileName || '',
        timestampIso,
      });
    }

    if (!persistedDirect) {
      const pendingEvent = runtimeVault.queuePendingEvent({
        type: 'incoming_message',
        payload: {
          ownerUid: bot.ownerUid,
          botId: bot.id,
          platform: bot.platform,
          customerId,
          platformUserId,
          platformName,
          username: username || '',
          avatarUrl: avatarUrl || '',
          messageId,
          platformMessageId,
          messageType,
          text,
          mediaUrl: mediaUrl || '',
          fileName: fileName || '',
          timestampIso,
        },
      });

      broadcastToClients(bot.ownerUid, {
        type: 'inbox:incoming',
        syncEventId: pendingEvent.id,
        data: pendingEvent.payload,
      });
    }

    // Execute matching active flows if permitted
    if (bot.permissions?.allowFlows !== false) {
      const flows = await resolveFlowsForBot(bot);
      for (const flow of flows) {
        try {
          const pendingOutPersists: Array<Promise<unknown>> = [];
          const result = await executeFlow(flow, {
            bot,
            plainToken,
            platformUserId,
            customerId,
            incomingText: text,
            onOutgoingMessage: (outMsg) => {
              const outId = `msg_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
              const outIso = new Date().toISOString();
              if (useDirectFirestore) {
                pendingOutPersists.push(
                  persistOutgoingMessageToFirestore({
                    ownerUid: bot.ownerUid,
                    botId: bot.id,
                    platform: bot.platform,
                    customerId,
                    platformUserId,
                    messageId: outId,
                    platformMessageId: outMsg.platformMessageId || '',
                    senderType: 'flow',
                    messageType: outMsg.messageType,
                    text: outMsg.text || '',
                    mediaUrl: outMsg.mediaUrl || '',
                    status: outMsg.status,
                    errorMessage: outMsg.errorMessage || '',
                    timestampIso: outIso,
                  })
                );
              } else {
                const outEvt = runtimeVault.queuePendingEvent({
                  type: 'outgoing_message',
                  payload: {
                    ownerUid: bot.ownerUid,
                    botId: bot.id,
                    platform: bot.platform,
                    customerId,
                    platformUserId,
                    messageId: outId,
                    platformMessageId: outMsg.platformMessageId || '',
                    senderType: 'flow',
                    messageType: outMsg.messageType,
                    text: outMsg.text || '',
                    mediaUrl: outMsg.mediaUrl || '',
                    status: outMsg.status,
                    errorMessage: outMsg.errorMessage || '',
                    timestampIso: outIso,
                  },
                });
                broadcastToClients(bot.ownerUid, {
                  type: 'inbox:outgoing',
                  syncEventId: outEvt.id,
                  data: outEvt.payload,
                });
              }
            },
          });

          if (pendingOutPersists.length > 0) {
            await Promise.all(pendingOutPersists);
          }

          if (result.executed) {
            const executedAt = new Date().toISOString();
            if (useDirectFirestore) {
              await persistFlowExecutedToFirestore(flow.id, executedAt);
            } else {
              const flowEvt = runtimeVault.queuePendingEvent({
                type: 'flow_executed',
                payload: {
                  ownerUid: bot.ownerUid,
                  flowId: flow.id,
                  executedAt,
                },
              });
              broadcastToClients(bot.ownerUid, {
                type: 'flow:executed',
                syncEventId: flowEvt.id,
                data: flowEvt.payload,
              });
            }
          }
        } catch (err) {
          const detail = err instanceof Error ? err.message : String(err);
          if (useDirectFirestore) {
            await persistErrorLogToFirestore({
              ownerUid: bot.ownerUid,
              source: 'flow',
              botId: bot.id,
              severity: 'error',
              message: `Flow "${flow.name}" execution error`,
              details: detail,
            });
          } else {
            const errEvt = runtimeVault.queuePendingEvent({
              type: 'error_log',
              payload: {
                ownerUid: bot.ownerUid,
                source: 'flow',
                botId: bot.id,
                severity: 'error',
                message: `Flow "${flow.name}" execution error`,
                details: detail,
              },
            });
            broadcastToClients(bot.ownerUid, {
              type: 'system:error_log',
              syncEventId: errEvt.id,
              data: errEvt.payload,
            });
          }
        }
      }
    }
  }

  async function processTelegramUpdate(
    bot: BotRecord,
    plainToken: string,
    update: Record<string, unknown>
  ) {
    const updateId = String(update.update_id || '');
    const msg = (update.message || update.edited_message) as
      | Record<string, unknown>
      | undefined;
    const callback = update.callback_query as Record<string, unknown> | undefined;

    if (callback) {
      const from = callback.from as Record<string, unknown> | undefined;
      const cbMsg = callback.message as Record<string, unknown> | undefined;
      const chat = cbMsg?.chat as Record<string, unknown> | undefined;
      const chatId = chat?.id ? String(chat.id) : from?.id ? String(from.id) : '';
      if (!chatId) return;

      const name = [from?.first_name, from?.last_name].filter(Boolean).join(' ') || 'Telegram User';
      await processIncomingMessagePipeline({
        bot,
        plainToken,
        platformUserId: chatId,
        platformName: name,
        username: from?.username ? `@${String(from.username)}` : '',
        platformMessageId: `cb_${updateId}`,
        messageType: 'text',
        text: String(callback.data || ''),
        timestampIso: new Date().toISOString(),
      });
      return;
    }

    if (!msg) return;
    const chat = msg.chat as Record<string, unknown> | undefined;
    const from = msg.from as Record<string, unknown> | undefined;
    const chatId = chat?.id ? String(chat.id) : '';
    if (!chatId) return;

    const platformName =
      [from?.first_name, from?.last_name].filter(Boolean).join(' ') ||
      String(chat?.title || chat?.username || `User ${chatId}`);
    const username = from?.username ? `@${String(from.username)}` : '';

    let messageType: MessageType = 'text';
    let text = String(msg.text || msg.caption || '');
    let mediaUrl = '';
    let fileName = '';

    if (Array.isArray(msg.photo) && msg.photo.length > 0) {
      messageType = 'image';
      const largest = msg.photo[msg.photo.length - 1] as Record<string, unknown>;
      if (largest?.file_id) {
        mediaUrl = `/api/media/telegram/${encodeURIComponent(bot.id)}/${encodeURIComponent(String(largest.file_id))}`;
      }
      if (!text) text = '[Photo]';
    } else if (msg.audio || msg.voice) {
      messageType = 'audio';
      const audioObj = (msg.audio || msg.voice) as Record<string, unknown>;
      if (audioObj?.file_id) {
        mediaUrl = `/api/media/telegram/${encodeURIComponent(bot.id)}/${encodeURIComponent(String(audioObj.file_id))}`;
      }
      fileName = String(audioObj?.file_name || 'voice-note.ogg');
      if (!text) text = `[Audio: ${fileName}]`;
    } else if (msg.document) {
      messageType = 'file';
      const docObj = msg.document as Record<string, unknown>;
      if (docObj?.file_id) {
        mediaUrl = `/api/media/telegram/${encodeURIComponent(bot.id)}/${encodeURIComponent(String(docObj.file_id))}`;
      }
      fileName = String(docObj?.file_name || 'document');
      if (!text) text = `[File: ${fileName}]`;
    }

    const msgDateSec = typeof msg.date === 'number' ? msg.date : Math.floor(Date.now() / 1000);
    await processIncomingMessagePipeline({
      bot,
      plainToken,
      platformUserId: chatId,
      platformName,
      username,
      platformMessageId: String(msg.message_id || updateId),
      messageType,
      text,
      mediaUrl,
      fileName,
      timestampIso: new Date(msgDateSec * 1000).toISOString(),
    });
  }

  // ========================
  // API ROUTES
  // ========================

  app.get('/api/health', (_req, res) => {
    const bots = runtimeVault.getAllBots();
    res.json({
      ok: true,
      service: 'FOREVER BOT API',
      runtime: IS_SERVERLESS ? 'vercel-serverless' : 'node-server',
      uptimeSeconds: Math.floor(process.uptime()),
      activeBotsInVault: bots.filter((b) => b.bot.status === 'connected').length,
      totalBotsInVault: bots.length,
      wsClients: getWsClientCount(),
      timestamp: new Date().toISOString(),
    });
  });

  app.post('/api/upload', requireAuth, upload.single('file'), (req: AuthRequest, res) => {
    if (!req.file) {
      res.status(400).json({ error: 'No file uploaded' });
      return;
    }
    const baseUrl = resolvePublicBaseUrl(req);
    let fileBase64 = '';
    if (req.file.size <= 3.5 * 1024 * 1024) {
      try {
        fileBase64 = fs.readFileSync(req.file.path).toString('base64');
      } catch {
        fileBase64 = '';
      }
    }
    res.json({
      ok: true,
      url: `${baseUrl}/uploads/${req.file.filename}`,
      relativeUrl: `/uploads/${req.file.filename}`,
      localPath: req.file.path,
      fileName: req.file.originalname,
      fileSize: req.file.size,
      mimeType: req.file.mimetype,
      fileBase64,
    });
  });

  // Secure Telegram Media Proxy (never exposes bot token to frontend)
  app.get('/api/media/telegram/:botId/:fileId', async (req, res) => {
    try {
      const botId = String(req.params.botId || '');
      const fileId = String(req.params.fileId || '');
      const entry = await resolveBotEntry(botId);
      if (!entry) {
        res.status(404).json({ error: 'Bot not found in active vault' });
        return;
      }
      const streamUrl = await getTelegramFileStreamUrl(entry.plainToken, fileId);
      if (!streamUrl) {
        res.status(404).json({ error: 'Telegram file not found' });
        return;
      }
      const upstream = await fetch(streamUrl);
      if (!upstream.ok || !upstream.body) {
        res.status(502).json({ error: 'Failed to download Telegram media' });
        return;
      }
      const ct = upstream.headers.get('content-type');
      if (ct) res.setHeader('Content-Type', ct);
      const buf = Buffer.from(await upstream.arrayBuffer());
      res.send(buf);
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : 'Media proxy failed' });
    }
  });

  // Bootstrap server vault from Firestore after login/redeploy
  app.post('/api/sync/bootstrap', requireAuth, (req: AuthRequest, res) => {
    try {
      const { bots, flows } = req.body as {
        bots?: BotRecord[];
        flows?: FlowRecord[];
      };

      let loadedBots = 0;
      if (Array.isArray(bots)) {
        for (const bot of bots) {
          if (bot.encryptedToken) {
            try {
              const plain = decryptToken(bot.encryptedToken);
              runtimeVault.setBot(bot, plain);
              loadedBots++;
            } catch (err) {
              console.warn(`Could not decrypt token for bot ${bot.id}:`, err);
            }
          }
        }
      }

      if (Array.isArray(flows)) {
        runtimeVault.syncFlows(flows);
      }

      const pendingEvents = runtimeVault.drainPendingEvents();
      res.json({
        ok: true,
        loadedBots,
        loadedFlows: Array.isArray(flows) ? flows.length : 0,
        pendingEvents,
      });
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : 'Bootstrap failed' });
    }
  });

  // Serverless-friendly Telegram polling endpoint (called by client when WebSocket is unavailable)
  app.post('/api/sync/poll', requireAuth, async (req: AuthRequest, res) => {
    try {
      const { bots, flows, offsets } = req.body as {
        bots?: BotRecord[];
        flows?: FlowRecord[];
        offsets?: Record<string, number>;
      };

      if (Array.isArray(flows)) {
        runtimeVault.syncFlows(flows);
      }

      const nextOffsets: Record<string, number> = { ...(offsets || {}) };
      let processedCount = 0;

      if (Array.isArray(bots)) {
        for (const bot of bots) {
          if (
            bot.platform !== 'telegram' ||
            bot.status !== 'connected' ||
            bot.syncMode !== 'polling' ||
            !bot.encryptedToken
          ) {
            continue;
          }

          let plainToken = runtimeVault.getBot(bot.id)?.plainToken || '';
          if (!plainToken) {
            try {
              plainToken = decryptToken(bot.encryptedToken);
              runtimeVault.setBot(bot, plainToken);
            } catch {
              continue;
            }
          }

          try {
            const knownOffset =
              nextOffsets[bot.id] ?? runtimeVault.getBot(bot.id)?.lastTelegramUpdateId;
            const updates = await fetchTelegramUpdates(
              plainToken,
              knownOffset ? knownOffset + 1 : undefined
            );
            for (const upd of updates) {
              const uid = Number(upd.update_id || 0);
              if (uid > (nextOffsets[bot.id] || 0)) {
                nextOffsets[bot.id] = uid;
                runtimeVault.setTelegramOffset(bot.id, uid);
              }
              await processTelegramUpdate(bot, plainToken, upd);
              processedCount++;
            }
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            if (!msg.includes('terminated by other getUpdates')) {
              console.warn(`Sync poll notice (${bot.name}): ${msg}`);
            }
          }
        }
      }

      res.json({ ok: true, processedCount, offsets: nextOffsets });
    } catch (error) {
      res.status(500).json({
        ok: false,
        error: error instanceof Error ? error.message : 'Poll failed',
      });
    }
  });

  app.post('/api/sync/flows', requireAuth, (req: AuthRequest, res) => {
    const { flows } = req.body as { flows?: FlowRecord[] };
    if (Array.isArray(flows)) {
      runtimeVault.syncFlows(flows);
    }
    res.json({ ok: true, count: Array.isArray(flows) ? flows.length : 0 });
  });

  app.post('/api/sync/ack', requireAuth, (req: AuthRequest, res) => {
    const { eventIds } = req.body as { eventIds?: string[] };
    if (Array.isArray(eventIds)) {
      for (const id of eventIds) {
        runtimeVault.ackPendingEvent(id);
      }
    }
    res.json({ ok: true });
  });

  // Verify token against REAL Telegram or Viber Bot API & encrypt for Firestore
  app.post('/api/bots/verify', requireAuth, async (req: AuthRequest, res) => {
    try {
      const { botId, name, platform, token, encryptedToken, syncMode, webhookBaseUrl } =
        req.body as {
          botId: string;
          name: string;
          platform: 'viber' | 'telegram';
          token?: string;
          encryptedToken?: string;
          syncMode?: 'webhook' | 'polling';
          webhookBaseUrl?: string;
        };

      let plainToken = token?.trim() || '';
      if (!plainToken && encryptedToken) {
        plainToken = decryptToken(encryptedToken);
      }
      if (!plainToken && botId) {
        plainToken = (await resolveBotEntry(botId))?.plainToken || '';
      }
      if (!plainToken) {
        res.status(400).json({ ok: false, error: 'Bot API token is required.' });
        return;
      }

      const testResult =
        platform === 'telegram'
          ? await testTelegramBot(plainToken)
          : await testViberBot(plainToken);

      if (!testResult.ok) {
        res.status(400).json({ ok: false, error: testResult.error });
        return;
      }

      const resolvedMode: 'webhook' | 'polling' =
        platform === 'viber' ? 'webhook' : syncMode || 'polling';

      const baseUrl = (webhookBaseUrl || resolvePublicBaseUrl(req)).replace(/\/+$/, '');
      const targetWebhookUrl = `${baseUrl}/api/webhooks/${platform}/${botId}`;
      let webhookStatus: BotRecord['webhookStatus'] =
        resolvedMode === 'polling' ? 'polling' : 'unset';
      let webhookError = '';
      let activeWebhookUrl = testResult.webhookUrl || '';

      if (platform === 'telegram') {
        if (resolvedMode === 'polling') {
          await deleteTelegramWebhook(plainToken);
          webhookStatus = 'polling';
          activeWebhookUrl = '';
        } else if (targetWebhookUrl.startsWith('https://')) {
          const wh = await setTelegramWebhook(plainToken, targetWebhookUrl);
          if (wh.ok) {
            webhookStatus = 'active';
            activeWebhookUrl = targetWebhookUrl;
          } else {
            webhookStatus = 'error';
            webhookError = wh.error || 'Webhook registration failed';
          }
        } else {
          webhookStatus = 'pending';
          activeWebhookUrl = targetWebhookUrl;
        }
      } else if (platform === 'viber') {
        if (targetWebhookUrl.startsWith('https://')) {
          const wh = await setViberWebhook(plainToken, targetWebhookUrl);
          if (wh.ok) {
            webhookStatus = 'active';
            activeWebhookUrl = targetWebhookUrl;
          } else {
            webhookStatus = 'error';
            webhookError = wh.error || 'Viber webhook registration failed';
          }
        } else {
          webhookStatus = 'pending';
          activeWebhookUrl = targetWebhookUrl;
        }
      }

      const newEncrypted = encryptToken(plainToken);
      const tokenMasked = maskToken(plainToken);
      const nowIso = new Date().toISOString();

      const botRecord: BotRecord = {
        id: botId,
        ownerUid: req.user!.uid,
        name: name || testResult.displayName || `${platform} Bot`,
        platform,
        status: 'connected',
        encryptedToken: newEncrypted,
        tokenMasked,
        botUsername: testResult.username || '',
        botPlatformId: testResult.platformId || '',
        webhookUrl: activeWebhookUrl || targetWebhookUrl,
        webhookStatus,
        syncMode: resolvedMode,
        lastSyncAt: nowIso,
        lastError: webhookError,
      };

      runtimeVault.setBot(botRecord, plainToken);

      res.json({
        ok: true,
        encryptedToken: newEncrypted,
        tokenMasked,
        botPlatformId: botRecord.botPlatformId,
        botUsername: botRecord.botUsername,
        displayName: testResult.displayName,
        subscribersCount: testResult.subscribersCount,
        webhookUrl: botRecord.webhookUrl,
        webhookStatus: botRecord.webhookStatus,
        syncMode: botRecord.syncMode,
        lastSyncAt: nowIso,
        lastError: webhookError,
      });
    } catch (error) {
      res.status(500).json({
        ok: false,
        error: error instanceof Error ? error.message : 'Verification failed',
      });
    }
  });

  app.post('/api/bots/:botId/webhook', requireAuth, async (req: AuthRequest, res) => {
    try {
      const botId = String(req.params.botId);
      const { action, webhookUrl, encryptedToken, platform } = req.body as {
        action: 'set' | 'remove' | 'polling';
        webhookUrl?: string;
        encryptedToken?: string;
        platform: 'viber' | 'telegram';
      };

      const entry = await resolveBotEntry(botId);
      let plainToken = entry?.plainToken || '';
      if (!plainToken && encryptedToken) {
        plainToken = decryptToken(encryptedToken);
      }
      if (!plainToken) {
        res.status(400).json({ ok: false, error: 'Bot token not available in vault.' });
        return;
      }

      const targetUrl =
        webhookUrl?.trim() || `${resolvePublicBaseUrl(req)}/api/webhooks/${platform}/${botId}`;

      if (platform === 'telegram') {
        if (action === 'polling') {
          const del = await deleteTelegramWebhook(plainToken);
          if (entry) {
            entry.bot.syncMode = 'polling';
            entry.bot.webhookStatus = 'polling';
            entry.bot.webhookUrl = '';
            runtimeVault.setBot(entry.bot, plainToken);
          }
          res.json({ ok: del.ok, webhookStatus: 'polling', webhookUrl: '', error: del.error });
          return;
        }
        if (action === 'remove') {
          const del = await deleteTelegramWebhook(plainToken);
          res.json({ ok: del.ok, webhookStatus: 'unset', webhookUrl: '', error: del.error });
          return;
        }
        const setRes = await setTelegramWebhook(plainToken, targetUrl);
        if (entry && setRes.ok) {
          entry.bot.syncMode = 'webhook';
          entry.bot.webhookStatus = 'active';
          entry.bot.webhookUrl = targetUrl;
          runtimeVault.setBot(entry.bot, plainToken);
        }
        res.json({
          ok: setRes.ok,
          webhookStatus: setRes.ok ? 'active' : 'error',
          webhookUrl: targetUrl,
          error: setRes.error,
        });
        return;
      }

      // Viber
      if (action === 'remove') {
        const rem = await removeViberWebhook(plainToken);
        res.json({ ok: rem.ok, webhookStatus: 'unset', webhookUrl: '', error: rem.error });
        return;
      }
      const vRes = await setViberWebhook(plainToken, targetUrl);
      if (entry && vRes.ok) {
        entry.bot.webhookStatus = 'active';
        entry.bot.webhookUrl = targetUrl;
        runtimeVault.setBot(entry.bot, plainToken);
      }
      res.json({
        ok: vRes.ok,
        webhookStatus: vRes.ok ? 'active' : 'error',
        webhookUrl: targetUrl,
        error: vRes.error,
      });
    } catch (error) {
      res.status(500).json({
        ok: false,
        error: error instanceof Error ? error.message : 'Webhook operation failed',
      });
    }
  });

  app.post('/api/bots/:botId/disconnect', requireAuth, async (req: AuthRequest, res) => {
    const botId = String(req.params.botId);
    const entry = runtimeVault.getBot(botId);
    if (entry) {
      entry.bot.status = 'disconnected';
      runtimeVault.setBot(entry.bot, entry.plainToken);
    }
    res.json({ ok: true });
  });

  app.delete('/api/bots/:botId', requireAuth, (req: AuthRequest, res) => {
    runtimeVault.deleteBot(String(req.params.botId));
    res.json({ ok: true });
  });

  // Send real reply to customer in Inbox
  app.post('/api/messages/send', requireAuth, async (req: AuthRequest, res) => {
    try {
      const {
        botId,
        platformUserId,
        messageType,
        text,
        mediaUrl,
        localFilePath,
        fileBase64,
        fileName,
        fileSize,
        encryptedToken,
        platform,
        botName,
      } = req.body as {
        botId: string;
        platformUserId: string;
        messageType: MessageType;
        text?: string;
        mediaUrl?: string;
        localFilePath?: string;
        fileBase64?: string;
        fileName?: string;
        fileSize?: number;
        encryptedToken?: string;
        platform?: 'viber' | 'telegram';
        botName?: string;
      };

      const entry = await resolveBotEntry(botId);
      const plainToken =
        entry?.plainToken || (encryptedToken ? decryptToken(encryptedToken) : '');
      const resolvedPlatform = entry?.bot.platform || platform;

      if (!plainToken || !resolvedPlatform) {
        res.status(400).json({
          ok: false,
          error: 'Bot is not connected or token is missing in server vault.',
        });
        return;
      }
      if (entry && entry.bot.status !== 'connected') {
        res.status(400).json({
          ok: false,
          error: 'Bot is currently disconnected. Connect the bot before sending messages.',
        });
        return;
      }

      const sendRes =
        resolvedPlatform === 'telegram'
          ? await sendTelegramMessage(plainToken, platformUserId, {
              messageType,
              text,
              mediaUrl,
              fileName,
              localFilePath,
              fileBase64,
            })
          : await sendViberMessage(plainToken, platformUserId, {
              messageType,
              text,
              mediaUrl,
              fileName,
              fileSize,
              senderName: entry?.bot.name || botName || 'FOREVER BOT',
            });

      if (!sendRes.ok) {
        res.status(400).json({ ok: false, error: sendRes.error });
        return;
      }

      res.json({ ok: true, platformMessageId: sendRes.platformMessageId || '' });
    } catch (error) {
      res.status(500).json({
        ok: false,
        error: error instanceof Error ? error.message : 'Failed to send message',
      });
    }
  });

  // Real Broadcast Queue Processor with Rate Limiting, Deduplication & Cancellation
  app.post('/api/broadcasts/send', requireAuth, async (req: AuthRequest, res) => {
    try {
      const {
        broadcastId,
        botId,
        recipients,
        messageType,
        text,
        mediaUrl,
        localFilePath,
        fileBase64,
        fileName,
        fileSize,
        dedupeKey,
        rateLimitMs,
        encryptedToken,
        platform,
        botName,
      } = req.body as {
        broadcastId: string;
        botId: string;
        recipients: Array<{ customerId: string; platformUserId: string; displayName: string }>;
        messageType: MessageType;
        text?: string;
        mediaUrl?: string;
        localFilePath?: string;
        fileBase64?: string;
        fileName?: string;
        fileSize?: number;
        dedupeKey?: string;
        rateLimitMs?: number;
        encryptedToken?: string;
        platform?: 'viber' | 'telegram';
        botName?: string;
      };

      if (!Array.isArray(recipients) || recipients.length === 0) {
        res.status(400).json({ ok: false, error: 'At least one eligible recipient is required.' });
        return;
      }

      if (dedupeKey) {
        const prev = recentBroadcastKeys.get(dedupeKey);
        if (prev && Date.now() - prev < 3 * 60 * 1000) {
          res.status(409).json({
            ok: false,
            error: 'Duplicate broadcast prevented. Identical campaign was sent recently.',
          });
          return;
        }
        recentBroadcastKeys.set(dedupeKey, Date.now());
      }

      const entry = await resolveBotEntry(botId);
      const plainToken =
        entry?.plainToken || (encryptedToken ? decryptToken(encryptedToken) : '');
      const resolvedPlatform = entry?.bot.platform || platform;

      if (!plainToken || !resolvedPlatform) {
        res.status(400).json({ ok: false, error: 'Bot is not connected in server vault.' });
        return;
      }
      if (entry && entry.bot.status !== 'connected') {
        res.status(400).json({ ok: false, error: 'Selected bot is disconnected.' });
        return;
      }
      if (entry?.bot.permissions?.allowBroadcast === false) {
        res.status(403).json({ ok: false, error: 'Broadcast permission is disabled for this bot.' });
        return;
      }

      const uniqueRecipients = Array.from(
        new Map(recipients.map((r) => [r.platformUserId, r])).values()
      );

      const controller = runtimeVault.registerBroadcastController(broadcastId);
      const delayMs = Math.min(Math.max(Number(rateLimitMs || 150), 80), 5000);
      const ownerUid = req.user!.uid;

      const runQueue = async () => {
        let successCount = 0;
        let failedCount = 0;

        for (const recipient of uniqueRecipients) {
          if (controller.cancelled) break;

          const sendRes =
            resolvedPlatform === 'telegram'
              ? await sendTelegramMessage(plainToken, recipient.platformUserId, {
                  messageType,
                  text,
                  mediaUrl,
                  fileName,
                  localFilePath,
                  fileBase64,
                })
              : await sendViberMessage(plainToken, recipient.platformUserId, {
                  messageType,
                  text,
                  mediaUrl,
                  fileName,
                  fileSize,
                  senderName: entry?.bot.name || botName || 'FOREVER BOT',
                });

          if (sendRes.ok) {
            successCount++;
          } else {
            failedCount++;
          }

          const outMsgId = `msg_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
          const outTimestamp = new Date().toISOString();

          if (IS_SERVERLESS || !hasActiveWsClient(ownerUid)) {
            await persistOutgoingMessageToFirestore({
              ownerUid,
              botId,
              platform: resolvedPlatform,
              customerId: recipient.customerId,
              platformUserId: recipient.platformUserId,
              messageId: outMsgId,
              platformMessageId: sendRes.platformMessageId || '',
              senderType: 'broadcast',
              messageType,
              text: text || '',
              mediaUrl: mediaUrl || '',
              fileName: fileName || '',
              status: sendRes.ok ? 'sent' : 'failed',
              errorMessage: sendRes.error || '',
              timestampIso: outTimestamp,
            });
            await updateBroadcastProgressInFirestore({
              broadcastId,
              successCount,
              failedCount,
              status: 'running',
            });
          } else {
            const outEvt = runtimeVault.queuePendingEvent({
              type: 'outgoing_message',
              payload: {
                ownerUid,
                botId,
                platform: resolvedPlatform,
                customerId: recipient.customerId,
                platformUserId: recipient.platformUserId,
                messageId: outMsgId,
                platformMessageId: sendRes.platformMessageId || '',
                senderType: 'broadcast',
                messageType,
                text: text || '',
                mediaUrl: mediaUrl || '',
                status: sendRes.ok ? 'sent' : 'failed',
                errorMessage: sendRes.error || '',
                timestampIso: outTimestamp,
              },
            });

            broadcastToClients(ownerUid, {
              type: 'broadcast:progress',
              syncEventId: outEvt.id,
              data: {
                broadcastId,
                totalTargets: uniqueRecipients.length,
                successCount,
                failedCount,
                status: 'running',
                messagePayload: outEvt.payload,
              },
            });
          }

          await new Promise((r) => setTimeout(r, delayMs));
        }

        const finalStatus = controller.cancelled
          ? 'cancelled'
          : successCount === 0 && failedCount > 0
          ? 'failed'
          : 'completed';
        const completedAt = new Date().toISOString();

        runtimeVault.cleanupBroadcast(broadcastId);
        if (IS_SERVERLESS || !hasActiveWsClient(ownerUid)) {
          await updateBroadcastProgressInFirestore({
            broadcastId,
            successCount,
            failedCount,
            status: finalStatus,
            completedAt,
          });
        } else {
          broadcastToClients(ownerUid, {
            type: 'broadcast:progress',
            data: {
              broadcastId,
              totalTargets: uniqueRecipients.length,
              successCount,
              failedCount,
              status: finalStatus,
              completedAt,
            },
          });
        }
        return { successCount, failedCount, finalStatus };
      };

      if (IS_SERVERLESS) {
        const result = await runQueue();
        res.json({ ok: true, queued: uniqueRecipients.length, ...result });
      } else {
        res.json({ ok: true, queued: uniqueRecipients.length });
        void runQueue();
      }
    } catch (error) {
      res.status(500).json({
        ok: false,
        error: error instanceof Error ? error.message : 'Broadcast launch failed',
      });
    }
  });

  app.post('/api/broadcasts/:broadcastId/cancel', requireAuth, (req: AuthRequest, res) => {
    const cancelled = runtimeVault.cancelBroadcast(String(req.params.broadcastId));
    res.json({ ok: true, cancelled });
  });

  // Test Flow Automation (Dry Run or Live Send to specific customer)
  app.post('/api/flows/test', requireAuth, async (req: AuthRequest, res) => {
    try {
      const { flow, sampleText, botId, platformUserId, liveSend } = req.body as {
        flow: FlowRecord;
        sampleText: string;
        botId?: string;
        platformUserId?: string;
        liveSend?: boolean;
      };

      const entry = botId ? await resolveBotEntry(botId) : runtimeVault.getAllBots()[0];
      const fallbackBot: BotRecord = entry?.bot || {
        id: 'dry_run_bot',
        ownerUid: req.user!.uid,
        name: 'Test Bot',
        platform: flow.platform === 'viber' ? 'viber' : 'telegram',
        status: 'connected',
      };

      const result = await executeFlow(flow, {
        bot: fallbackBot,
        plainToken: entry?.plainToken || '',
        platformUserId: platformUserId || 'dry_run_user',
        customerId: 'dry_run_customer',
        incomingText: sampleText || '',
        dryRun: !liveSend || !entry?.plainToken || !platformUserId,
      });

      res.json({ ok: true, ...result });
    } catch (error) {
      res.status(500).json({
        ok: false,
        error: error instanceof Error ? error.message : 'Flow test failed',
      });
    }
  });

  // ========================
  // PUBLIC BOT WEBHOOKS
  // ========================

  app.post('/api/webhooks/telegram/:botId', async (req, res) => {
    const botId = String(req.params.botId);
    const entry = await resolveBotEntry(botId);

    if (!entry || entry.bot.platform !== 'telegram' || entry.bot.status !== 'connected') {
      res.sendStatus(200);
      return;
    }

    if (IS_SERVERLESS) {
      try {
        await processTelegramUpdate(entry.bot, entry.plainToken, req.body || {});
      } catch (err) {
        console.error('Telegram webhook error:', err);
      }
      res.sendStatus(200);
    } else {
      res.sendStatus(200);
      try {
        await processTelegramUpdate(entry.bot, entry.plainToken, req.body || {});
      } catch (err) {
        console.error('Telegram webhook error:', err);
      }
    }
  });

  app.post('/api/webhooks/viber/:botId', async (req, res) => {
    const botId = String(req.params.botId);
    const entry = await resolveBotEntry(botId);
    const body = (req.body || {}) as Record<string, unknown>;

    // Viber sends a 'webhook' event during set_webhook verification
    if (body.event === 'webhook') {
      res.status(200).json({ status: 0, status_message: 'ok' });
      return;
    }

    if (entry && entry.plainToken) {
      const sig = req.headers['x-viber-content-signature'] as string | undefined;
      const rawBody =
        (req as express.Request & { rawBody?: string }).rawBody || JSON.stringify(body);
      if (sig && !verifyViberSignature(rawBody, sig, entry.plainToken)) {
        res.status(403).json({ error: 'Invalid Viber signature' });
        return;
      }
    }

    if (!entry || entry.bot.platform !== 'viber' || entry.bot.status !== 'connected') {
      res.status(200).json({ status: 0, status_message: 'ok' });
      return;
    }

    const handleViberBody = async () => {
      try {
        const event = String(body.event || '');
        if (event === 'message') {
          const sender = (body.sender || {}) as Record<string, unknown>;
          const message = (body.message || {}) as Record<string, unknown>;
          const senderId = String(sender.id || '');
          if (!senderId) return;

          const vType = String(message.type || 'text');
          let messageType: MessageType = 'text';
          let text = String(message.text || '');
          let mediaUrl = '';
          let fileName = '';

          if (vType === 'picture') {
            messageType = 'image';
            mediaUrl = String(message.media || '');
            if (!text) text = '[Photo]';
          } else if (vType === 'file') {
            messageType = 'file';
            mediaUrl = String(message.media || '');
            fileName = String(message.file_name || 'attachment');
            if (!text) text = `[File: ${fileName}]`;
          } else if (vType === 'video') {
            messageType = 'file';
            mediaUrl = String(message.media || '');
            fileName = 'video.mp4';
            if (!text) text = '[Video]';
          }

          await processIncomingMessagePipeline({
            bot: entry.bot,
            plainToken: entry.plainToken,
            platformUserId: senderId,
            platformName: String(sender.name || `Viber User ${senderId.slice(0, 6)}`),
            avatarUrl: String(sender.avatar || ''),
            platformMessageId: String(body.message_token || Date.now()),
            messageType,
            text,
            mediaUrl,
            fileName,
            timestampIso: new Date(
              typeof body.timestamp === 'number' ? body.timestamp : Date.now()
            ).toISOString(),
          });
        } else if (event === 'conversation_started' || event === 'subscribed') {
          const user = (body.user || {}) as Record<string, unknown>;
          const userId = String(user.id || '');
          if (!userId) return;
          await processIncomingMessagePipeline({
            bot: entry.bot,
            plainToken: entry.plainToken,
            platformUserId: userId,
            platformName: String(user.name || 'Viber Subscriber'),
            avatarUrl: String(user.avatar || ''),
            platformMessageId: `sub_${body.message_token || Date.now()}`,
            messageType: 'text',
            text: event === 'subscribed' ? '[Subscribed to bot]' : '[Started conversation]',
            timestampIso: new Date().toISOString(),
          });
        }
      } catch (err) {
        console.error('Viber webhook processing error:', err);
      }
    };

    if (IS_SERVERLESS) {
      await handleViberBody();
      res.status(200).json({ status: 0, status_message: 'ok' });
    } else {
      res.status(200).json({ status: 0, status_message: 'ok' });
      void handleViberBody();
    }
  });

  return { app, processTelegramUpdate };
}
