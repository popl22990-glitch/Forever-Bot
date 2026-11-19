import fs from 'fs';
import path from 'path';

export interface ServerFirebaseConfig {
  projectId: string;
  apiKey: string;
  firestoreDatabaseId: string;
}

let cachedConfig: ServerFirebaseConfig | null = null;

export function getServerFirebaseConfig(): ServerFirebaseConfig {
  if (cachedConfig) return cachedConfig;

  const candidates = [
    path.resolve(process.cwd(), 'firebase-applet-config.json'),
    new URL('../../firebase-applet-config.json', import.meta.url),
  ];

  for (const target of candidates) {
    try {
      if (fs.existsSync(target)) {
        const parsed = JSON.parse(fs.readFileSync(target, 'utf8')) as Partial<ServerFirebaseConfig>;
        if (parsed.projectId && parsed.apiKey && parsed.firestoreDatabaseId) {
          cachedConfig = {
            projectId: parsed.projectId,
            apiKey: parsed.apiKey,
            firestoreDatabaseId: parsed.firestoreDatabaseId,
          };
          return cachedConfig;
        }
      }
    } catch {
      // Try next candidate
    }
  }

  cachedConfig = {
    projectId: process.env.FIREBASE_PROJECT_ID || 'gen-lang-client-0250089335',
    apiKey: process.env.FIREBASE_API_KEY || 'AIzaSyBVrzTVQdcHbB2G8L39DXbbtb64yfJXhfU',
    firestoreDatabaseId:
      process.env.FIREBASE_DATABASE_ID || 'ai-studio-f3284ad1-8615-42fc-ac93-13ef74c6f3a7',
  };
  return cachedConfig;
}
