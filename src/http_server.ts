import { createServer, IncomingMessage, Server, ServerResponse } from 'node:http';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { OuraProvider } from './provider/oura_provider.js';
import { registerFitSyncInboxTool } from './provider/fitsync_inbox.js';
import { isAuthorizedDirectRequest, isSecretPath, RemoteAuthConfig } from './remote_auth.js';
import { healthBody } from './health.js';

type HttpServerOptions = {
  remoteAuth: RemoteAuthConfig;
  config: {
    auth: { personalAccessToken: string; clientId: string; clientSecret: string };
    debug: boolean;
  };
};

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
}

export function createHttpServer(options: HttpServerOptions): Server {
  return createServer((req, res) => {
    handleRequest(req, res, options).catch((error) => {
      // Never let a request error escape: an unhandled rejection exits the process.
      console.error('Request error:', error);
      try {
        if (res.headersSent) {
          res.end();
        } else {
          sendJson(res, 500, { error: 'Internal server error' });
        }
      } catch {
        res.destroy();
      }
    });
  });
}

async function handleRequest(req: IncomingMessage, res: ServerResponse, options: HttpServerOptions): Promise<void> {
  if (req.url === '/health' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify(healthBody()));
    return;
  }

  // MCP endpoint — matches:
  //   /mcp              (requires Bearer token header)
  //   /<secret>/mcp     (secret path = auth, no header needed — for Claude.ai connector)
  let pathname: string;
  try {
    pathname = new URL(req.url || '/', `http://${req.headers.host}`).pathname;
  } catch {
    sendJson(res, 400, { error: 'Bad request' });
    return;
  }

  const isDirectMcp = pathname === '/mcp';
  const isSecretMcp = isSecretPath(pathname, options.remoteAuth);

  if (isDirectMcp || isSecretMcp) {
    // Secret-path requests are pre-authenticated; direct requests need header auth
    if (isDirectMcp && !isAuthorizedDirectRequest(req, options.remoteAuth)) {
      res.writeHead(401, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify({ error: 'Unauthorized' }));
      return;
    }

    if (req.method === 'POST') {
      // One MCP server per stateless HTTP request prevents concurrent calls
      // from replacing each other's transport on the shared Server instance.
      const provider = new OuraProvider({
        personalAccessToken: options.config.auth.personalAccessToken,
        clientId: options.config.auth.clientId,
        clientSecret: options.config.auth.clientSecret,
        debug: options.config.debug,
      });
      const mcpServer = provider.getServer();
      if (process.env.FITSYNC_INBOX_ENABLED === '1') {
        registerFitSyncInboxTool(mcpServer);
      }
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
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

  res.writeHead(404, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify({ error: 'Not found' }));
}
