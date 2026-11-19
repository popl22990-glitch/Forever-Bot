import type { IncomingMessage, ServerResponse } from 'http';
import { createApp } from './createApp.ts';

let cachedApp: ReturnType<typeof createApp>['app'] | null = null;

function getApp() {
  if (!cachedApp) {
    cachedApp = createApp().app;
  }
  return cachedApp;
}

export default function handler(req: IncomingMessage, res: ServerResponse) {
  try {
    const rawUrl = req.url || '/';
    const parsed = new URL(rawUrl, 'http://localhost');
    const vpath = parsed.searchParams.get('__vpath');
    if (vpath) {
      parsed.searchParams.delete('__vpath');
      const cleanPath = vpath.startsWith('/') ? vpath : `/${vpath}`;
      const qs = parsed.searchParams.toString();
      req.url = qs ? `${cleanPath}?${qs}` : cleanPath;
    }
    const app = getApp();
    return app(req as Parameters<typeof app>[0], res as Parameters<typeof app>[1]);
  } catch (err) {
    res.statusCode = 500;
    res.setHeader('Content-Type', 'application/json');
    res.end(
      JSON.stringify({
        ok: false,
        error: err instanceof Error ? err.message : 'Serverless invocation error',
      })
    );
  }
}
