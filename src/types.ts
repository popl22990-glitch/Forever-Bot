export type Platform = 'viber' | 'telegram';
export type BotStatus = 'connected' | 'disconnected' | 'error' | 'awaiting_config';
export type WebhookStatus = 'active' | 'pending' | 'error' | 'polling' | 'unset';
export type SyncMode = 'webhook' | 'polling';

export interface BotPermissions {
  allowBroadcast: boolean;
  allowFlows: boolean;
  allowMedia: boolean;
  autoCreateCustomer: boolean;
}

export interface BotRecord {
  id: string;
  ownerUid: string;
  name: string;
  platform: Platform;
  status: BotStatus;
  encryptedToken?: string;
  tokenMasked?: string;
  botUsername?: string;
  botPlatformId?: string;
  webhookUrl?: string;
  webhookStatus?: WebhookStatus;
  syncMode?: SyncMode;
  lastSyncAt?: string;
  lastError?: string;
  permissions?: BotPermissions;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface CustomerRecord {
  id: string;
  ownerUid: string;
  botId: string;
  platform: Platform;
  platformUserId: string;
  platformName?: string;
  displayName: string;
  avatarUrl?: string;
  username?: string;
  isSubscribed: boolean;
  lastMessageText?: string;
  lastMessageAt?: string;
  unreadCount: number;
  firstContactAt?: string;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export type MessageDirection = 'incoming' | 'outgoing';
export type MessageSenderType = 'customer' | 'admin' | 'flow' | 'broadcast';
export type MessageType = 'text' | 'image' | 'audio' | 'file';
export type MessageStatus = 'received' | 'sent' | 'delivered' | 'failed';

export interface MessageRecord {
  id: string;
  ownerUid: string;
  customerId: string;
  botId: string;
  platform: Platform;
  platformUserId: string;
  platformMessageId?: string;
  direction: MessageDirection;
  senderType: MessageSenderType;
  messageType: MessageType;
  text?: string;
  mediaUrl?: string;
  fileName?: string;
  status: MessageStatus;
  errorMessage?: string;
  timestampIso?: string;
  createdAt?: unknown;
}

export type BroadcastStatus = 'queued' | 'running' | 'completed' | 'cancelled' | 'failed';

export interface BroadcastRecord {
  id: string;
  ownerUid: string;
  title: string;
  botId: string;
  platform: Platform | 'multi';
  messageType: MessageType;
  text?: string;
  mediaUrl?: string;
  dedupeKey?: string;
  totalTargets: number;
  successCount: number;
  failedCount: number;
  status: BroadcastStatus;
  startedAt?: string;
  completedAt?: string;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export type FlowNodeType =
  | 'start'
  | 'keyword_trigger'
  | 'send_message'
  | 'send_image'
  | 'send_audio'
  | 'delay'
  | 'condition'
  | 'customer_reply'
  | 'end';

export interface FlowNode {
  id: string;
  type: FlowNodeType;
  label: string;
  x: number;
  y: number;
  config: {
    text?: string;
    mediaUrl?: string;
    delaySeconds?: number;
    keyword?: string;
    matchMode?: 'contains' | 'exact' | 'starts_with';
    conditionField?: 'message_text' | 'platform';
    conditionOperator?: 'contains' | 'equals' | 'not_equals';
    conditionValue?: string;
  };
}

export interface FlowEdge {
  id: string;
  sourceId: string;
  targetId: string;
  branch?: 'default' | 'true' | 'false';
}

export interface FlowRecord {
  id: string;
  ownerUid: string;
  name: string;
  botId: string; // 'all' or specific botId
  platform: 'all' | Platform;
  isActive: boolean;
  triggerKeywords?: string[];
  nodes: FlowNode[];
  edges: FlowEdge[];
  executionCount: number;
  lastExecutedAt?: string;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface AppSettingsRecord {
  id: string;
  ownerUid: string;
  soundEnabled: boolean;
  volume: number;
  viberTone: 'royal_chime' | 'crimson_bell' | 'crystal_ping';
  telegramTone: 'gold_pulse' | 'velvet_chord' | 'sharp_alert';
  browserNotificationsEnabled: boolean;
  platformName: string;
  defaultWebhookBaseUrl: string;
  broadcastRateLimitMs: number;
  broadcastRequireConfirm: boolean;
  updatedAt?: unknown;
}

export interface ErrorLogRecord {
  id: string;
  ownerUid: string;
  source: 'viber_api' | 'telegram_api' | 'webhook' | 'broadcast' | 'flow' | 'database' | 'system';
  botId?: string;
  severity: 'info' | 'warning' | 'error';
  message: string;
  details?: string;
  createdAt?: unknown;
}

export type NavSection =
  | 'dashboard'
  | 'inbox'
  | 'broadcast'
  | 'bots'
  | 'channels'
  | 'flows'
  | 'customers'
  | 'notifications'
  | 'settings';
