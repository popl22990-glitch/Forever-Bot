import 'dotenv/config';
import express from 'express';
import http from 'http';
import path from 'path';
import { WebSocketServer, WebSocket } from 'ws';
import { createServer as createViteServer } from 'vite';
import { verifyBearerToken } from './src/server/firebaseAuthMiddleware.ts';
import { runtimeVault } from './src/server/cryptoVault.ts';
import { fetchTelegramUpdates } from './src/server/botApis.ts';
import { createApp } from './src/server/createApp.ts';

const PORT = Number(process.env.PORT || 3000);

async function startServer() {
  const authenticatedClients = new Map<WebSocket, { uid: string; email?: string }>();

  function hasActiveWsClient(ownerUid: string): boolean {
    for (const [client, meta] of authenticatedClients.entries()) {
      if (
        client.readyState === WebSocket.OPEN &&
        (meta.uid === ownerUid ||
          ownerUid === 'forever_bot_workspace' ||
          meta.email === 'ultraspin168@gmail.com')
      ) {
        return true;
      }
    }
    return false;
  }

  function broadcastToClients(ownerUid: string, event: Record<string, unknown>) {
    const payload = JSON.stringify(event);
    for (const [client, meta] of authenticatedClients.entries()) {
      if (
        client.readyState === WebSocket.OPEN &&
        (meta.uid === ownerUid ||
          ownerUid === 'forever_bot_workspace' ||
          meta.email === 'ultraspin168@gmail.com')
      ) {
        client.send(payload);
      }
    }
  }

  const { app, processTelegramUpdate } = createApp({
    broadcastToClients,
    hasActiveWsClient,
    getWsClientCount: () => authenticatedClients.size,
  });

  const server = http.createServer(app);

  // WebSocket server attached on /ws
  const wss = new WebSocketServer({ server, path: '/ws' });
  wss.on('connection', async (ws, req) => {
    try {
      const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
      const token = url.searchParams.get('token');
      if (token) {
        const decoded = await verifyBearerToken(token);
        authenticatedClients.set(ws, { uid: decoded.uid, email: decoded.email });
        ws.send(JSON.stringify({ type: 'ws:connected', uid: decoded.uid }));
      } else {
        authenticatedClients.set(ws, { uid: 'forever_bot_workspace' });
        ws.send(JSON.stringify({ type: 'ws:connected', uid: 'forever_bot_workspace' }));
      }

      ws.on('close', () => {
        authenticatedClients.delete(ws);
      });
    } catch {
      ws.close(4003, 'Invalid auth token');
    }
  });

  // Background Telegram Polling loop for bots configured in 'polling' syncMode
  let pollingInFlight = false;
  setInterval(async () => {
    if (pollingInFlight) return;
    pollingInFlight = true;
    try {
      const entries = runtimeVault.getAllBots();
      for (const entry of entries) {
        if (
          entry.bot.platform === 'telegram' &&
          entry.bot.status === 'connected' &&
          entry.bot.syncMode === 'polling' &&
          entry.plainToken
        ) {
          try {
            const offset = entry.lastTelegramUpdateId
              ? entry.lastTelegramUpdateId + 1
              : undefined;
            const updates = await fetchTelegramUpdates(entry.plainToken, offset);
            for (const upd of updates) {
              const uid = Number(upd.update_id || 0);
              if (uid > (entry.lastTelegramUpdateId || 0)) {
                runtimeVault.setTelegramOffset(entry.bot.id, uid);
              }
              await processTelegramUpdate(entry.bot, entry.plainToken, upd);
            }
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            if (!msg.includes('terminated by other getUpdates')) {
              console.warn(`Telegram polling notice (${entry.bot.name}): ${msg}`);
            }
          }
        }
      }
    } finally {
      pollingInFlight = false;
    }
  }, 3500);

  // Vite Dev Middleware or Production Static Serving
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  server.listen(PORT, '0.0.0.0', () => {
    console.log(`FOREVER BOT server listening on port ${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Fatal server startup error:', err);
  process.exit(1);
});
