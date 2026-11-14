/**
 * Remote HTTP server entry point for oura-mcp.
 * Exposes the same Oura MCP tools over Streamable HTTP transport
 * so any Claude client (Desktop, phone, work machine) can connect via URL.
 *
 * Usage: OURA_PERSONAL_ACCESS_TOKEN=xxx node build/server.js
 * Listens on PORT (default 3000).
 */

import { config as dotenvConfig } from 'dotenv';
import { remoteAuthConfig } from './remote_auth.js';
import { createHttpServer } from './http_server.js';

dotenvConfig();

const PORT = parseInt(process.env.PORT || '3000', 10);
const remoteAuth = remoteAuthConfig();

const config = {
  auth: {
    personalAccessToken: process.env.OURA_PERSONAL_ACCESS_TOKEN || '',
    clientId: process.env.OURA_CLIENT_ID || '',
    clientSecret: process.env.OURA_CLIENT_SECRET || '',
  },
  debug: process.env.OURA_MCP_DEBUG === '1',
};

function validateConfig() {
  const { personalAccessToken, clientId, clientSecret } = config.auth;
  if (!personalAccessToken && (!clientId || !clientSecret)) {
    throw new Error(
      'Either OURA_PERSONAL_ACCESS_TOKEN or both OURA_CLIENT_ID and OURA_CLIENT_SECRET must be provided'
    );
  }
}

async function main() {
  validateConfig();

  const httpServer = createHttpServer({ remoteAuth, config });

  httpServer.listen(PORT, '0.0.0.0', () => {
    console.error(`🟢 Oura MCP server listening on http://0.0.0.0:${PORT}`);
    console.error(`   MCP endpoint: POST /mcp (Bearer auth)`);
    console.error('   Secret endpoint: configured for Claude connection');
    console.error(`   Health check: GET /health`);
  });
}

main().catch((error) => {
  console.error('Server error:', error);
  process.exit(1);
});
