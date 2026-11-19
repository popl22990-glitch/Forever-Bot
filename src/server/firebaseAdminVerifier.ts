import { getServerFirebaseConfig } from './firebaseConfig.ts';
import type { WorkspaceIdentity } from './firebaseAuthMiddleware.ts';

export async function verifyBearerToken(token: string): Promise<WorkspaceIdentity> {
  const [{ initializeApp, getApps }, { getAuth }] = await Promise.all([
    import('firebase-admin/app'),
    import('firebase-admin/auth'),
  ]);
  if (!getApps().length) {
    const firebaseConfig = getServerFirebaseConfig();
    initializeApp({ projectId: firebaseConfig.projectId });
  }
  const decoded = await getAuth().verifyIdToken(token);
  if (!decoded.email_verified) {
    throw new Error('Administrator email must be verified.');
  }
  return { uid: decoded.uid, email: decoded.email };
}
