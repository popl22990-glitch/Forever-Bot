import type { Request, Response, NextFunction } from 'express';

export const WORKSPACE_OWNER_UID = 'forever_bot_workspace';

export interface WorkspaceIdentity {
  uid: string;
  email?: string;
}

export interface AuthRequest extends Request {
  user?: WorkspaceIdentity;
}

export type TokenVerifier = (token: string) => Promise<WorkspaceIdentity>;

export function createRequireAuth(verifyToken?: TokenVerifier) {
  return async (
    req: AuthRequest,
    res: Response,
    next: NextFunction
  ): Promise<void> => {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ') || !verifyToken) {
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
      req.user = await verifyToken(token);
      next();
    } catch (error) {
      res.status(401).json({
        error: error instanceof Error ? error.message : 'Unauthorized: Invalid token',
      });
    }
  };
}
