import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import type { MessageType } from '../types.ts';

export interface BotConnectionTestResult {
  ok: boolean;
  platformId?: string;
  username?: string;
  displayName?: string;
  subscribersCount?: number;
  webhookUrl?: string;
  error?: string;
}

export interface SendMessageResult {
  ok: boolean;
  platformMessageId?: string;
  error?: string;
}

const TELEGRAM_API_BASE = 'https://api.telegram.org';
const VIBER_API_BASE = 'https://chatapi.viber.com/pa';

export async function testTelegramBot(token: string): Promise<BotConnectionTestResult> {
  try {
    const [meRes, whRes] = await Promise.all([
      fetch(`${TELEGRAM_API_BASE}/bot${token}/getMe`),
      fetch(`${TELEGRAM_API_BASE}/bot${token}/getWebhookInfo`),
    ]);
    const meJson = (await meRes.json()) as {
      ok: boolean;
      description?: string;
      result?: { id: number; username?: string; first_name?: string };
    };
    if (!meJson.ok || !meJson.result) {
      return {
        ok: false,
        error: meJson.description || 'Telegram API rejected the bot token.',
      };
    }

    let webhookUrl = '';
    try {
      const whJson = (await whRes.json()) as {
        ok: boolean;
        result?: { url?: string };
      };
      if (whJson.ok && whJson.result?.url) {
        webhookUrl = whJson.result.url;
      }
    } catch {
      // ignore webhook info error
    }

    return {
      ok: true,
      platformId: String(meJson.result.id),
      username: meJson.result.username ? `@${meJson.result.username}` : '',
      displayName: meJson.result.first_name || meJson.result.username || 'Telegram Bot',
      webhookUrl,
    };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : 'Failed to reach Telegram API.',
    };
  }
}

export async function setTelegramWebhook(
  token: string,
  webhookUrl: string
): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await fetch(`${TELEGRAM_API_BASE}/bot${token}/setWebhook`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        url: webhookUrl,
        allowed_updates: ['message', 'edited_message', 'callback_query'],
      }),
    });
    const json = (await res.json()) as { ok: boolean; description?: string };
    if (!json.ok) {
      return { ok: false, error: json.description || 'Failed to set Telegram webhook.' };
    }
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : 'Network error setting Telegram webhook.',
    };
  }
}

export async function deleteTelegramWebhook(
  token: string
): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await fetch(`${TELEGRAM_API_BASE}/bot${token}/deleteWebhook`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ drop_pending_updates: false }),
    });
    const json = (await res.json()) as { ok: boolean; description?: string };
    if (!json.ok) {
      return { ok: false, error: json.description || 'Failed to clear Telegram webhook.' };
    }
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : 'Network error clearing Telegram webhook.',
    };
  }
}

export async function fetchTelegramUpdates(token: string, offset?: number) {
  const params = new URLSearchParams({
    limit: '25',
    timeout: '0',
    allowed_updates: JSON.stringify(['message', 'callback_query']),
  });
  if (offset !== undefined) {
    params.set('offset', String(offset));
  }
  const res = await fetch(`${TELEGRAM_API_BASE}/bot${token}/getUpdates?${params.toString()}`);
  const json = (await res.json()) as {
    ok: boolean;
    description?: string;
    result?: Array<Record<string, unknown>>;
  };
  if (!json.ok) {
    throw new Error(json.description || 'Telegram getUpdates failed');
  }
  return json.result || [];
}

export async function getTelegramFileStreamUrl(token: string, fileId: string): Promise<string | null> {
  const res = await fetch(
    `${TELEGRAM_API_BASE}/bot${token}/getFile?file_id=${encodeURIComponent(fileId)}`
  );
  const json = (await res.json()) as { ok: boolean; result?: { file_path?: string } };
  if (!json.ok || !json.result?.file_path) return null;
  return `${TELEGRAM_API_BASE}/file/bot${token}/${json.result.file_path}`;
}

export async function sendTelegramMessage(
  token: string,
  chatId: string,
  payload: {
    messageType: MessageType;
    text?: string;
    mediaUrl?: string;
    fileName?: string;
    localFilePath?: string;
    fileBase64?: string;
  }
): Promise<SendMessageResult> {
  try {
    const { messageType, text, mediaUrl, fileName, localFilePath, fileBase64 } = payload;

    if (messageType === 'text') {
      const res = await fetch(`${TELEGRAM_API_BASE}/bot${token}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: chatId,
          text: text || '',
        }),
      });
      const json = (await res.json()) as {
        ok: boolean;
        description?: string;
        result?: { message_id: number };
      };
      if (!json.ok) {
        return { ok: false, error: json.description || 'Telegram sendMessage failed.' };
      }
      return {
        ok: true,
        platformMessageId: json.result ? String(json.result.message_id) : undefined,
      };
    }

    const endpoint =
      messageType === 'image'
        ? 'sendPhoto'
        : messageType === 'audio'
        ? 'sendAudio'
        : 'sendDocument';
    const fieldName =
      messageType === 'image'
        ? 'photo'
        : messageType === 'audio'
        ? 'audio'
        : 'document';

    if ((localFilePath && fs.existsSync(localFilePath)) || fileBase64) {
      const fileBuffer =
        localFilePath && fs.existsSync(localFilePath)
          ? fs.readFileSync(localFilePath)
          : Buffer.from(fileBase64!, 'base64');
      const blob = new Blob([fileBuffer]);
      const form = new FormData();
      form.append('chat_id', chatId);
      form.append(fieldName, blob, fileName || (localFilePath ? path.basename(localFilePath) : 'attachment'));
      if (text) form.append('caption', text);

      const res = await fetch(`${TELEGRAM_API_BASE}/bot${token}/${endpoint}`, {
        method: 'POST',
        body: form,
      });
      const json = (await res.json()) as {
        ok: boolean;
        description?: string;
        result?: { message_id: number };
      };
      if (!json.ok) {
        return { ok: false, error: json.description || `Telegram ${endpoint} failed.` };
      }
      return {
        ok: true,
        platformMessageId: json.result ? String(json.result.message_id) : undefined,
      };
    }

    if (!mediaUrl) {
      return { ok: false, error: 'Media URL or uploaded file is required for media messages.' };
    }

    const res = await fetch(`${TELEGRAM_API_BASE}/bot${token}/${endpoint}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        [fieldName]: mediaUrl,
        ...(text ? { caption: text } : {}),
      }),
    });
    const json = (await res.json()) as {
      ok: boolean;
      description?: string;
      result?: { message_id: number };
    };
    if (!json.ok) {
      return { ok: false, error: json.description || `Telegram ${endpoint} failed.` };
    }
    return {
      ok: true,
      platformMessageId: json.result ? String(json.result.message_id) : undefined,
    };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : 'Telegram send failed.',
    };
  }
}

export async function testViberBot(token: string): Promise<BotConnectionTestResult> {
  try {
    const res = await fetch(`${VIBER_API_BASE}/get_account_info`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Viber-Auth-Token': token,
      },
      body: JSON.stringify({}),
    });
    const json = (await res.json()) as {
      status: number;
      status_message?: string;
      id?: string;
      name?: string;
      uri?: string;
      subscribers_count?: number;
      webhook?: string;
    };
    if (json.status !== 0) {
      return {
        ok: false,
        error: json.status_message || `Viber API error (status ${json.status})`,
      };
    }
    return {
      ok: true,
      platformId: json.id || '',
      username: json.uri ? `@${json.uri}` : json.name || '',
      displayName: json.name || 'Viber Bot',
      subscribersCount: json.subscribers_count ?? 0,
      webhookUrl: json.webhook || '',
    };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : 'Failed to reach Viber Bot API.',
    };
  }
}

export async function setViberWebhook(
  token: string,
  webhookUrl: string
): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await fetch(`${VIBER_API_BASE}/set_webhook`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Viber-Auth-Token': token,
      },
      body: JSON.stringify({
        url: webhookUrl,
        event_types: [
          'delivered',
          'seen',
          'failed',
          'subscribed',
          'unsubscribed',
          'conversation_started',
        ],
        send_name: true,
        send_photo: true,
      }),
    });
    const json = (await res.json()) as { status: number; status_message?: string };
    if (json.status !== 0) {
      return {
        ok: false,
        error: json.status_message || `Viber set_webhook failed (status ${json.status})`,
      };
    }
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : 'Network error setting Viber webhook.',
    };
  }
}

export async function removeViberWebhook(token: string): Promise<{ ok: boolean; error?: string }> {
  return setViberWebhook(token, '');
}

export async function sendViberMessage(
  token: string,
  receiverId: string,
  payload: {
    messageType: MessageType;
    text?: string;
    mediaUrl?: string;
    fileName?: string;
    fileSize?: number;
    senderName?: string;
  }
): Promise<SendMessageResult> {
  try {
    const sender = { name: (payload.senderName || 'FOREVER BOT').slice(0, 28) };
    let body: Record<string, unknown>;

    if (payload.messageType === 'text') {
      body = {
        receiver: receiverId,
        min_api_version: 1,
        sender,
        type: 'text',
        text: payload.text || '',
      };
    } else if (payload.messageType === 'image') {
      if (!payload.mediaUrl) {
        return { ok: false, error: 'Publicly accessible HTTPS image URL is required for Viber.' };
      }
      body = {
        receiver: receiverId,
        min_api_version: 1,
        sender,
        type: 'picture',
        text: payload.text || '',
        media: payload.mediaUrl,
      };
    } else {
      if (!payload.mediaUrl) {
        return { ok: false, error: 'Publicly accessible HTTPS media URL is required for Viber.' };
      }
      body = {
        receiver: receiverId,
        min_api_version: 1,
        sender,
        type: 'file',
        media: payload.mediaUrl,
        size: payload.fileSize || 102400,
        file_name: payload.fileName || (payload.messageType === 'audio' ? 'audio.mp3' : 'attachment'),
      };
    }

    const res = await fetch(`${VIBER_API_BASE}/send_message`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Viber-Auth-Token': token,
      },
      body: JSON.stringify(body),
    });

    const json = (await res.json()) as {
      status: number;
      status_message?: string;
      message_token?: number;
    };

    if (json.status !== 0) {
      return {
        ok: false,
        error: json.status_message || `Viber send_message failed (status ${json.status})`,
      };
    }

    return {
      ok: true,
      platformMessageId: json.message_token ? String(json.message_token) : undefined,
    };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : 'Viber send_message failed.',
    };
  }
}

export function verifyViberSignature(
  rawBody: string,
  signatureHeader: string | undefined,
  token: string
): boolean {
  if (!signatureHeader) return false;
  const expected = crypto.createHmac('sha256', token).update(rawBody).digest('hex');
  try {
    return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signatureHeader));
  } catch {
    return false;
  }
}
