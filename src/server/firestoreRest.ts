import type {
  BotRecord,
  ErrorLogRecord,
  FlowRecord,
  MessageRecord,
  Platform,
} from '../types.ts';
import { getServerFirebaseConfig } from './firebaseConfig.ts';

const firebaseConfig = getServerFirebaseConfig();

const BASE_DOC_ROOT = `projects/${firebaseConfig.projectId}/databases/${firebaseConfig.firestoreDatabaseId}/documents`;
const REST_BASE = `https://firestore.googleapis.com/v1/${BASE_DOC_ROOT}`;
const API_KEY = firebaseConfig.apiKey;

type FsValue =
  | { stringValue: string }
  | { integerValue: string }
  | { doubleValue: number }
  | { booleanValue: boolean }
  | { nullValue: null }
  | { timestampValue: string }
  | { mapValue: { fields?: Record<string, FsValue> } }
  | { arrayValue: { values?: FsValue[] } };

function toFsValue(val: unknown): FsValue {
  if (val === null || val === undefined) return { nullValue: null };
  if (typeof val === 'boolean') return { booleanValue: val };
  if (typeof val === 'number') {
    return Number.isInteger(val) ? { integerValue: String(val) } : { doubleValue: val };
  }
  if (typeof val === 'string') return { stringValue: val };
  if (Array.isArray(val)) {
    return { arrayValue: { values: val.map((item) => toFsValue(item)) } };
  }
  if (typeof val === 'object') {
    const fields: Record<string, FsValue> = {};
    for (const [k, v] of Object.entries(val as Record<string, unknown>)) {
      if (v !== undefined) {
        fields[k] = toFsValue(v);
      }
    }
    return { mapValue: { fields } };
  }
  return { stringValue: String(val) };
}

function fromFsValue(val: FsValue | undefined): unknown {
  if (!val) return undefined;
  if ('stringValue' in val) return val.stringValue;
  if ('integerValue' in val) return Number(val.integerValue);
  if ('doubleValue' in val) return Number(val.doubleValue);
  if ('booleanValue' in val) return val.booleanValue;
  if ('nullValue' in val) return null;
  if ('timestampValue' in val) return val.timestampValue;
  if ('arrayValue' in val) {
    return (val.arrayValue.values || []).map((v) => fromFsValue(v));
  }
  if ('mapValue' in val) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(val.mapValue.fields || {})) {
      out[k] = fromFsValue(v);
    }
    return out;
  }
  return undefined;
}

function parseFsDoc<T>(docJson: { fields?: Record<string, FsValue> }): T {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(docJson.fields || {})) {
    out[k] = fromFsValue(v);
  }
  return out as T;
}

function toFsFields(obj: Record<string, unknown>): Record<string, FsValue> {
  const fields: Record<string, FsValue> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v !== undefined) {
      fields[k] = toFsValue(v);
    }
  }
  return fields;
}

async function commitWrites(writes: Array<Record<string, unknown>>): Promise<boolean> {
  try {
    const res = await fetch(`${REST_BASE}:commit?key=${encodeURIComponent(API_KEY)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ writes }),
    });
    if (!res.ok) {
      const errTxt = await res.text().catch(() => '');
      console.warn('Firestore REST commit failed:', res.status, errTxt.slice(0, 300));
      return false;
    }
    return true;
  } catch (err) {
    console.warn('Firestore REST commit network error:', err);
    return false;
  }
}

export async function fetchBotFromFirestore(botId: string): Promise<BotRecord | null> {
  try {
    const safeId = botId.replace(/[^a-zA-Z0-9_\-]/g, '');
    if (!safeId) return null;
    const res = await fetch(
      `${REST_BASE}/bots/${encodeURIComponent(safeId)}?key=${encodeURIComponent(API_KEY)}`
    );
    if (!res.ok) return null;
    const json = (await res.json()) as { fields?: Record<string, FsValue> };
    if (!json.fields) return null;
    return parseFsDoc<BotRecord>(json);
  } catch {
    return null;
  }
}

export async function fetchActiveFlowsFromFirestore(ownerUid: string): Promise<FlowRecord[]> {
  try {
    const res = await fetch(`${REST_BASE}:runQuery?key=${encodeURIComponent(API_KEY)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        structuredQuery: {
          from: [{ collectionId: 'flows' }],
          where: {
            compositeFilter: {
              op: 'AND',
              filters: [
                {
                  fieldFilter: {
                    field: { fieldPath: 'ownerUid' },
                    op: 'EQUAL',
                    value: { stringValue: ownerUid },
                  },
                },
                {
                  fieldFilter: {
                    field: { fieldPath: 'isActive' },
                    op: 'EQUAL',
                    value: { booleanValue: true },
                  },
                },
              ],
            },
          },
        },
      }),
    });
    if (!res.ok) return [];
    const rows = (await res.json()) as Array<{ document?: { fields?: Record<string, FsValue> } }>;
    const flows: FlowRecord[] = [];
    for (const row of rows) {
      if (row.document?.fields) {
        flows.push(parseFsDoc<FlowRecord>(row.document));
      }
    }
    return flows;
  } catch {
    return [];
  }
}

export async function persistIncomingMessageToFirestore(params: {
  ownerUid: string;
  botId: string;
  platform: Platform;
  customerId: string;
  platformUserId: string;
  platformName: string;
  username: string;
  avatarUrl: string;
  messageId: string;
  platformMessageId: string;
  messageType: MessageRecord['messageType'];
  text: string;
  mediaUrl: string;
  fileName: string;
  timestampIso: string;
}): Promise<boolean> {
  try {
    const custRes = await fetch(
      `${REST_BASE}/customers/${encodeURIComponent(params.customerId)}?key=${encodeURIComponent(API_KEY)}`
    );
    const customerExists = custRes.ok;
    let currentUnread = 0;
    if (customerExists) {
      const existingJson = (await custRes.json()) as { fields?: Record<string, FsValue> };
      const parsed = parseFsDoc<{ unreadCount?: number }>(existingJson);
      currentUnread = Number(parsed.unreadCount || 0);
    }

    const custPath = `${BASE_DOC_ROOT}/customers/${params.customerId}`;
    const msgPath = `${BASE_DOC_ROOT}/messages/${params.messageId}`;

    const customerWrite: Record<string, unknown> = customerExists
      ? {
          update: {
            name: custPath,
            fields: toFsFields({
              platformName: params.platformName.slice(0, 160),
              avatarUrl: params.avatarUrl.slice(0, 1024),
              username: params.username.slice(0, 128),
              isSubscribed: true,
              lastMessageText: params.text.slice(0, 1900),
              lastMessageAt: params.timestampIso.slice(0, 64),
              unreadCount: Math.min(currentUnread + 1, 100000),
            }),
          },
          updateMask: {
            fieldPaths: [
              'platformName',
              'avatarUrl',
              'username',
              'isSubscribed',
              'lastMessageText',
              'lastMessageAt',
              'unreadCount',
              'updatedAt',
            ],
          },
          updateTransforms: [{ fieldPath: 'updatedAt', setToServerValue: 'REQUEST_TIME' }],
        }
      : {
          update: {
            name: custPath,
            fields: toFsFields({
              id: params.customerId,
              ownerUid: params.ownerUid,
              botId: params.botId,
              platform: params.platform,
              platformUserId: params.platformUserId.slice(0, 256),
              platformName: params.platformName.slice(0, 160),
              displayName: params.platformName.slice(0, 160),
              avatarUrl: params.avatarUrl.slice(0, 1024),
              username: params.username.slice(0, 128),
              isSubscribed: true,
              lastMessageText: params.text.slice(0, 1900),
              lastMessageAt: params.timestampIso.slice(0, 64),
              unreadCount: 1,
              firstContactAt: params.timestampIso.slice(0, 64),
            }),
          },
          currentDocument: { exists: false },
          updateTransforms: [
            { fieldPath: 'createdAt', setToServerValue: 'REQUEST_TIME' },
            { fieldPath: 'updatedAt', setToServerValue: 'REQUEST_TIME' },
          ],
        };

    const messageWrite: Record<string, unknown> = {
      update: {
        name: msgPath,
        fields: toFsFields({
          id: params.messageId,
          ownerUid: params.ownerUid,
          customerId: params.customerId,
          botId: params.botId,
          platform: params.platform,
          platformUserId: params.platformUserId.slice(0, 256),
          platformMessageId: params.platformMessageId.slice(0, 256),
          direction: 'incoming',
          senderType: 'customer',
          messageType: params.messageType,
          text: params.text.slice(0, 4000),
          mediaUrl: params.mediaUrl.slice(0, 1024),
          fileName: params.fileName.slice(0, 256),
          status: 'received',
          errorMessage: '',
          timestampIso: params.timestampIso.slice(0, 64),
        }),
      },
      currentDocument: { exists: false },
      updateTransforms: [{ fieldPath: 'createdAt', setToServerValue: 'REQUEST_TIME' }],
    };

    return await commitWrites([customerWrite, messageWrite]);
  } catch (err) {
    console.warn('persistIncomingMessageToFirestore error:', err);
    return false;
  }
}

export async function persistOutgoingMessageToFirestore(params: {
  ownerUid: string;
  botId: string;
  platform: Platform;
  customerId: string;
  platformUserId: string;
  messageId: string;
  platformMessageId: string;
  senderType: MessageRecord['senderType'];
  messageType: MessageRecord['messageType'];
  text: string;
  mediaUrl: string;
  fileName?: string;
  status: MessageRecord['status'];
  errorMessage: string;
  timestampIso: string;
}): Promise<boolean> {
  const msgPath = `${BASE_DOC_ROOT}/messages/${params.messageId}`;
  return commitWrites([
    {
      update: {
        name: msgPath,
        fields: toFsFields({
          id: params.messageId,
          ownerUid: params.ownerUid,
          customerId: params.customerId,
          botId: params.botId,
          platform: params.platform,
          platformUserId: params.platformUserId.slice(0, 256),
          platformMessageId: params.platformMessageId.slice(0, 256),
          direction: 'outgoing',
          senderType: params.senderType,
          messageType: params.messageType,
          text: params.text.slice(0, 4000),
          mediaUrl: params.mediaUrl.slice(0, 1024),
          fileName: (params.fileName || '').slice(0, 256),
          status: params.status,
          errorMessage: params.errorMessage.slice(0, 1000),
          timestampIso: params.timestampIso.slice(0, 64),
        }),
      },
      currentDocument: { exists: false },
      updateTransforms: [{ fieldPath: 'createdAt', setToServerValue: 'REQUEST_TIME' }],
    },
  ]);
}

export async function persistFlowExecutedToFirestore(
  flowId: string,
  executedAt: string
): Promise<boolean> {
  const flowPath = `${BASE_DOC_ROOT}/flows/${flowId}`;
  return commitWrites([
    {
      update: {
        name: flowPath,
        fields: toFsFields({
          lastExecutedAt: executedAt.slice(0, 64),
        }),
      },
      updateMask: {
        fieldPaths: ['executionCount', 'lastExecutedAt', 'updatedAt'],
      },
      updateTransforms: [
        { fieldPath: 'executionCount', increment: { integerValue: '1' } },
        { fieldPath: 'updatedAt', setToServerValue: 'REQUEST_TIME' },
      ],
    },
  ]);
}

export async function updateBroadcastProgressInFirestore(params: {
  broadcastId: string;
  successCount: number;
  failedCount: number;
  status: 'running' | 'completed' | 'cancelled' | 'failed';
  completedAt?: string;
}): Promise<boolean> {
  const bcPath = `${BASE_DOC_ROOT}/broadcasts/${params.broadcastId}`;
  const fields: Record<string, unknown> = {
    successCount: params.successCount,
    failedCount: params.failedCount,
    status: params.status,
  };
  const fieldPaths = ['successCount', 'failedCount', 'status', 'updatedAt'];
  if (params.completedAt) {
    fields.completedAt = params.completedAt.slice(0, 64);
    fieldPaths.push('completedAt');
  }
  return commitWrites([
    {
      update: {
        name: bcPath,
        fields: toFsFields(fields),
      },
      updateMask: { fieldPaths },
      updateTransforms: [{ fieldPath: 'updatedAt', setToServerValue: 'REQUEST_TIME' }],
    },
  ]);
}

export async function persistErrorLogToFirestore(params: {
  ownerUid: string;
  source: ErrorLogRecord['source'];
  botId?: string;
  severity: ErrorLogRecord['severity'];
  message: string;
  details?: string;
}): Promise<boolean> {
  const logId = `err_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  const logPath = `${BASE_DOC_ROOT}/error_logs/${logId}`;
  return commitWrites([
    {
      update: {
        name: logPath,
        fields: toFsFields({
          id: logId,
          ownerUid: params.ownerUid,
          source: params.source,
          botId: (params.botId || '').slice(0, 128),
          severity: params.severity,
          message: params.message.slice(0, 500),
          details: (params.details || '').slice(0, 2000),
        }),
      },
      currentDocument: { exists: false },
      updateTransforms: [{ fieldPath: 'createdAt', setToServerValue: 'REQUEST_TIME' }],
    },
  ]);
}
