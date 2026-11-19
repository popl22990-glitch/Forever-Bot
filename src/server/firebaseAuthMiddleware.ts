import type { Request, Response, NextFunction } from 'express';
import { getServerFirebaseConfig } from './firebaseConfig.ts';

export const WORKSPACE_OWNER_UID = 'forever_bot_workspace';

export interface WorkspaceIdentity {
  uid: string;
  email?: string;
}

export interface AuthRequest extends Request {
  user?: WorkspaceIdentity;
}

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

export const requireAuth = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    req.user = { uid: WORKSPACE_OWNER_UID };
    next();
    return;
  }

  const token = authHeader.slice('Bearer '.length).trim();
  if (!token) {
    req.user = { uid: WORKSPACE_OWNER_UID };
    next();
    return;
  }

  try {
    req.user = await verifyBearerToken(token);
    next();
  } catch (error) {
    res.status(401).json({
      error: error instanceof Error ? error.message : 'Unauthorized: Invalid token',
    });
  }
};
