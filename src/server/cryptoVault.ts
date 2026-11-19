import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import type { BotRecord, FlowRecord, MessageRecord, CustomerRecord, ErrorLogRecord } from '../types.ts';

const firebaseConfig = JSON.parse(
  fs.readFileSync(path.resolve(process.cwd(), 'firebase-applet-config.json'), 'utf8')
) as { apiKey: string; projectId: string };

const IS_SERVERLESS = Boolean(process.env.VERCEL === '1' || process.env.AWS_LAMBDA_FUNCTION_NAME);
const DATA_DIR = IS_SERVERLESS
  ? path.join(os.tmpdir(), 'forever-bot-data')
  : path.resolve(process.cwd(), '.data');
const VAULT_FILE = path.join(DATA_DIR, 'runtime-vault.json');

function getEncryptionKey(): Buffer {
  const secret =
    process.env.TOKEN_ENCRYPTION_SECRET ||
    process.env.GEMINI_API_KEY ||
    `${firebaseConfig.apiKey}:${firebaseConfig.projectId}:forever-bot-vault-v1`;
  return crypto.createHash('sha256').update(secret).digest();
}

export function encryptToken(plainToken: string): string {
  const iv = crypto.randomBytes(12);
  const key = getEncryptionKey();
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(plainToken, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted.toString('hex')}`;
}

export function decryptToken(encryptedPayload: string): string {
  const parts = encryptedPayload.split(':');
  if (parts.length !== 3) {
    throw new Error('Malformed encrypted token payload');
  }
  const [ivHex, authTagHex, dataHex] = parts;
  const iv = Buffer.from(ivHex, 'hex');
  const authTag = Buffer.from(authTagHex, 'hex');
  const encrypted = Buffer.from(dataHex, 'hex');
  const key = getEncryptionKey();
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(authTag);
  const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);
  return decrypted.toString('utf8');
}

export function maskToken(token: string): string {
  const trimmed = token.trim();
  if (trimmed.length <= 8) return '••••••••';
  return `${trimmed.slice(0, 4)}••••••${trimmed.slice(-4)}`;
}

export interface ServerBotEntry {
  bot: BotRecord;
  plainToken: string;
  lastTelegramUpdateId?: number;
}

export interface PendingSyncEvent {
  id: string;
  type: 'incoming_message' | 'outgoing_message' | 'customer_upsert' | 'error_log' | 'flow_executed';
  payload: Record<string, unknown>;
  createdAtIso: string;
}

interface PersistedVault {
  bots: Record<string, ServerBotEntry>;
  flows: Record<string, FlowRecord>;
  pendingEvents: PendingSyncEvent[];
  recentMessageIds: string[];
}

class RuntimeVault {
  private bots = new Map<string, ServerBotEntry>();
  private flows = new Map<string, FlowRecord>();
  private pendingEvents: PendingSyncEvent[] = [];
  private recentMessageIds = new Set<string>();
  private activeBroadcastControllers = new Map<string, { cancelled: boolean }>();

  constructor() {
    this.loadFromDisk();
  }

  private ensureDir() {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
  }

  private loadFromDisk() {
    try {
      if (fs.existsSync(VAULT_FILE)) {
        const raw = fs.readFileSync(VAULT_FILE, 'utf8');
        const parsed = JSON.parse(raw) as PersistedVault;
        if (parsed.bots) {
          for (const [k, v] of Object.entries(parsed.bots)) {
            this.bots.set(k, v);
          }
        }
        if (parsed.flows) {
          for (const [k, v] of Object.entries(parsed.flows)) {
            this.flows.set(k, v);
          }
        }
        if (Array.isArray(parsed.pendingEvents)) {
          this.pendingEvents = parsed.pendingEvents;
        }
        if (Array.isArray(parsed.recentMessageIds)) {
          for (const id of parsed.recentMessageIds.slice(-1000)) {
            this.recentMessageIds.add(id);
          }
        }
      }
    } catch (err) {
      console.error('Failed to load runtime vault from disk:', err);
    }
  }

  private saveToDisk() {
    try {
      this.ensureDir();
      const data: PersistedVault = {
        bots: Object.fromEntries(this.bots.entries()),
        flows: Object.fromEntries(this.flows.entries()),
        pendingEvents: this.pendingEvents.slice(-500),
        recentMessageIds: Array.from(this.recentMessageIds).slice(-1000),
      };
      fs.writeFileSync(VAULT_FILE, JSON.stringify(data, null, 2), 'utf8');
    } catch (err) {
      console.error('Failed to persist runtime vault to disk:', err);
    }
  }

  setBot(bot: BotRecord, plainToken: string) {
    const existing = this.bots.get(bot.id);
    this.bots.set(bot.id, {
      bot,
      plainToken,
      lastTelegramUpdateId: existing?.lastTelegramUpdateId,
    });
    this.saveToDisk();
  }

  getBot(botId: string): ServerBotEntry | undefined {
    return this.bots.get(botId);
  }

  getAllBots(): ServerBotEntry[] {
    return Array.from(this.bots.values());
  }

  deleteBot(botId: string) {
    this.bots.delete(botId);
    this.saveToDisk();
  }

  setTelegramOffset(botId: string, offset: number) {
    const entry = this.bots.get(botId);
    if (entry) {
      entry.lastTelegramUpdateId = offset;
      this.saveToDisk();
    }
  }

  syncFlows(flows: FlowRecord[]) {
    this.flows.clear();
    for (const f of flows) {
      this.flows.set(f.id, f);
    }
    this.saveToDisk();
  }

  getFlowsForBot(botId: string, platform: 'viber' | 'telegram'): FlowRecord[] {
    return Array.from(this.flows.values()).filter(
      (f) =>
        f.isActive &&
        (f.botId === 'all' || f.botId === botId) &&
        (f.platform === 'all' || f.platform === platform)
    );
  }

  hasProcessedMessage(dedupeId: string): boolean {
    if (!dedupeId) return false;
    return this.recentMessageIds.has(dedupeId);
  }

  markMessageProcessed(dedupeId: string) {
    if (!dedupeId) return;
    this.recentMessageIds.add(dedupeId);
    if (this.recentMessageIds.size > 1500) {
      const first = this.recentMessageIds.values().next().value;
      if (first) this.recentMessageIds.delete(first);
    }
    this.saveToDisk();
  }

  queuePendingEvent(event: Omit<PendingSyncEvent, 'id' | 'createdAtIso'>): PendingSyncEvent {
    const full: PendingSyncEvent = {
      ...event,
      id: `evt_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`,
      createdAtIso: new Date().toISOString(),
    };
    this.pendingEvents.push(full);
    if (this.pendingEvents.length > 500) {
      this.pendingEvents = this.pendingEvents.slice(-500);
    }
    this.saveToDisk();
    return full;
  }

  drainPendingEvents(): PendingSyncEvent[] {
    const events = [...this.pendingEvents];
    this.pendingEvents = [];
    this.saveToDisk();
    return events;
  }

  ackPendingEvent(eventId: string) {
    const before = this.pendingEvents.length;
    this.pendingEvents = this.pendingEvents.filter((e) => e.id !== eventId);
    if (this.pendingEvents.length !== before) {
      this.saveToDisk();
    }
  }

  registerBroadcastController(broadcastId: string): { cancelled: boolean } {
    const ctrl = { cancelled: false };
    this.activeBroadcastControllers.set(broadcastId, ctrl);
    return ctrl;
  }

  cancelBroadcast(broadcastId: string): boolean {
    const ctrl = this.activeBroadcastControllers.get(broadcastId);
    if (ctrl) {
      ctrl.cancelled = true;
      return true;
    }
    return false;
  }

  cleanupBroadcast(broadcastId: string) {
    this.activeBroadcastControllers.delete(broadcastId);
  }
}

export const runtimeVault = new RuntimeVault();

export function makeSafeId(raw: string): string {
  return raw.replace(/[^a-zA-Z0-9_\-]/g, '_').slice(0, 120);
}

export function buildCustomerId(botId: string, platformUserId: string): string {
  const hash = crypto
    .createHash('sha1')
    .update(`${botId}:${platformUserId}`)
    .digest('hex')
    .slice(0, 16);
  const prefix = makeSafeId(botId).slice(0, 24);
  return `${prefix}_${hash}`;
}

export type { CustomerRecord, MessageRecord, ErrorLogRecord };
