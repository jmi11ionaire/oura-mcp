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

dotenvConfig();

const PORT = parseInt(process.env.PORT || '3000', 10);
const MCP_AUTH_TOKEN = process.env.MCP_AUTH_TOKEN || ''; // optional bearer token for header-based auth
const MCP_SECRET_PATH = process.env.MCP_SECRET_PATH || ''; // secret URL path segment (for clients that can't set headers)

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

// ---------- Auth middleware ----------
function checkAuth(req: IncomingMessage, res: ServerResponse): boolean {
  if (!MCP_AUTH_TOKEN) return true; // no token configured = open
  const authHeader = req.headers.authorization || '';
  // Support Bearer token
  if (authHeader === `Bearer ${MCP_AUTH_TOKEN}`) return true;
  // Support token as query param (for clients that can't set headers)
  const url = new URL(req.url || '/', `http://${req.headers.host}`);
  if (url.searchParams.get('token') === MCP_AUTH_TOKEN) return true;
  res.writeHead(401, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'Unauthorized' }));
  return false;
}

// ---------- Main ----------
async function main() {
  validateConfig();

  const provider = new OuraProvider({
    personalAccessToken: config.auth.personalAccessToken,
    clientId: config.auth.clientId,
    clientSecret: config.auth.clientSecret,
    redirectUri: config.auth.redirectUri,
    debug: config.debug,
  });

  const mcpServer = provider.getServer();

  const httpServer = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    // Health check
    if (req.url === '/health' && req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok' }));
      return;
    }

    // MCP endpoint — matches:
    //   /mcp              (requires Bearer token header)
    //   /<secret>/mcp     (secret path = auth, no header needed — for Claude.ai connector)
    const parsedUrl = new URL(req.url || '/', `http://${req.headers.host}`);
    const pathname = parsedUrl.pathname;

    const isDirectMcp = pathname === '/mcp' || pathname === '/';
    const isSecretMcp = MCP_SECRET_PATH && pathname === `/${MCP_SECRET_PATH}/mcp`;

    if (isDirectMcp || isSecretMcp) {
      // Secret-path requests are pre-authenticated; direct requests need header auth
      if (isDirectMcp && !checkAuth(req, res)) return;

      if (req.method === 'POST') {
        const transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: undefined, // stateless mode
        });

        await mcpServer.connect(transport);
        await transport.handleRequest(req, res);
        transport.close();
        return;
      }

      res.writeHead(405, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Method not allowed. Use POST for MCP requests.' }));
      return;
    }

    // 404 for everything else
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Not found' }));
  });

  const secretUrl = MCP_SECRET_PATH ? `/${MCP_SECRET_PATH}/mcp` : '(not configured)';
  httpServer.listen(PORT, '0.0.0.0', () => {
    console.error(`🟢 Oura MCP server listening on http://0.0.0.0:${PORT}`);
    console.error(`   MCP endpoint: POST /mcp (Bearer auth)`);
    console.error(`   Secret endpoint: POST ${secretUrl} (no auth header needed)`);
    console.error(`   Health check: GET /health`);
  });
}

main().catch((error) => {
  console.error('Server error:', error);
  process.exit(1);
});
