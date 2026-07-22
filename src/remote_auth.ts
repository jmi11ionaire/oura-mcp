import { timingSafeEqual } from 'node:crypto';
import type { IncomingMessage } from 'node:http';

export type RemoteAuthConfig = {
  bearerToken: string;
  secretPath: string;
};

export function remoteAuthConfig(env: NodeJS.ProcessEnv = process.env): RemoteAuthConfig {
  const bearerToken = env.MCP_AUTH_TOKEN?.trim() || '';
  const secretPath = env.MCP_SECRET_PATH?.trim() || '';
  if (bearerToken.length < 32) {
    throw new Error('MCP_AUTH_TOKEN must be configured with at least 32 characters.');
  }
  if (!/^[A-Za-z0-9_-]{32,160}$/.test(secretPath)) {
    throw new Error('MCP_SECRET_PATH must be a 32-160 character URL-safe secret.');
  }
  return { bearerToken, secretPath };
}

export function isAuthorizedDirectRequest(req: IncomingMessage, config: RemoteAuthConfig): boolean {
  const authorization = req.headers.authorization || '';
  return constantTimeEqual(authorization, `Bearer ${config.bearerToken}`);
}

export function isSecretPath(pathname: string, config: RemoteAuthConfig): boolean {
  return constantTimeEqual(pathname, `/${config.secretPath}/mcp`);
}

function constantTimeEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  if (leftBuffer.length !== rightBuffer.length) return false;
  return timingSafeEqual(leftBuffer, rightBuffer);
}
