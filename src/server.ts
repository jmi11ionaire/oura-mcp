/**
 * Remote HTTP server entry point for oura-mcp.
 * Exposes the same Oura MCP tools over Streamable HTTP transport
 * so any Claude client (Desktop, phone, work machine) can connect via URL.
 *
 * Usage: OURA_PERSONAL_ACCESS_TOKEN=xxx node build/server.js
 * Listens on PORT (default 3000).
 */

import { config as dotenvConfig } from 'dotenv';
import { createServer, IncomingMessage, ServerResponse } from 'node:http';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { OuraProvider } from './provider/oura_provider.js';
import { registerFitSyncInboxTool } from './provider/fitsync_inbox.js';
import { isAuthorizedDirectRequest, isSecretPath, remoteAuthConfig } from './remote_auth.js';

dotenvConfig();

const PORT = parseInt(process.env.PORT || '3000', 10);
const remoteAuth = remoteAuthConfig();

const config = {
  auth: {
    personalAccessToken: process.env.OURA_PERSONAL_ACCESS_TOKEN || '',
    clientId: process.env.OURA_CLIENT_ID || '',
    clientSecret: process.env.OURA_CLIENT_SECRET || '',
    redirectUri: process.env.OURA_REDIRECT_URI || 'http://localhost:3000/callback',
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

// ---------- Main ----------
async function main() {
  validateConfig();

  const httpServer = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    // Health check
    if (req.url === '/health' && req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify({ status: 'ok' }));
      return;
    }

    // MCP endpoint — matches:
    //   /mcp              (requires Bearer token header)
    //   /<secret>/mcp     (secret path = auth, no header needed — for Claude.ai connector)
    const parsedUrl = new URL(req.url || '/', `http://${req.headers.host}`);
    const pathname = parsedUrl.pathname;

    const isDirectMcp = pathname === '/mcp';
    const isSecretMcp = isSecretPath(pathname, remoteAuth);

    if (isDirectMcp || isSecretMcp) {
      // Secret-path requests are pre-authenticated; direct requests need header auth
      if (isDirectMcp && !isAuthorizedDirectRequest(req, remoteAuth)) {
        res.writeHead(401, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
        res.end(JSON.stringify({ error: 'Unauthorized' }));
        return;
      }

      if (req.method === 'POST') {
        // One MCP server per stateless HTTP request prevents concurrent calls
        // from replacing each other's transport on the shared Server instance.
        const provider = new OuraProvider({
          personalAccessToken: config.auth.personalAccessToken,
          clientId: config.auth.clientId,
          clientSecret: config.auth.clientSecret,
          redirectUri: config.auth.redirectUri,
          debug: config.debug,
        });
        const mcpServer = provider.getServer();
        if (process.env.FITSYNC_INBOX_ENABLED === '1') {
          registerFitSyncInboxTool(mcpServer);
        }
        const transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: undefined, // stateless mode
        });

        await mcpServer.connect(transport);
        await transport.handleRequest(req, res);
        transport.close();
        return;
      }

      res.writeHead(405, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify({ error: 'Method not allowed. Use POST for MCP requests.' }));
      return;
    }

    // 404 for everything else
    res.writeHead(404, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify({ error: 'Not found' }));
  });

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
