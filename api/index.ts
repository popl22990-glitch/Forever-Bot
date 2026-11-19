import type { IncomingMessage, ServerResponse } from 'http';
import { createApp } from '../src/server/createApp.ts';

const { app } = createApp();

export default function handler(req: IncomingMessage, res: ServerResponse) {
  const rawUrl = req.url || '/';
  const parsed = new URL(rawUrl, 'http://localhost');
  const vpath = parsed.searchParams.get('__vpath');
  if (vpath) {
    parsed.searchParams.delete('__vpath');
    const cleanPath = vpath.startsWith('/') ? vpath : `/${vpath}`;
    const qs = parsed.searchParams.toString();
    req.url = qs ? `${cleanPath}?${qs}` : cleanPath;
  }
  return app(req as Parameters<typeof app>[0], res as Parameters<typeof app>[1]);
}
