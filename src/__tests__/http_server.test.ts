import { connect, AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { createHttpServer } from '../http_server.js';

const remoteAuth = { bearerToken: 'b'.repeat(40), secretPath: 's'.repeat(40) };
const config = { auth: { personalAccessToken: 'x', clientId: '', clientSecret: '' }, debug: false };

// Raw socket request so no client library normalises the path or headers.
function raw(port: number, request: string): Promise<{ status: number; headers: string; body: string }> {
  return new Promise((resolve, reject) => {
    const socket = connect(port, '127.0.0.1');
    let data = '';
    socket.setEncoding('utf8');
    socket.on('connect', () => socket.write(request));
    socket.on('data', (chunk) => (data += chunk));
    socket.on('error', reject);
    socket.on('close', () => {
      const [headers, ...rest] = data.split('\r\n\r\n');
      let body = rest.join('\r\n\r\n');
      if (/transfer-encoding: chunked/i.test(headers)) {
        // Single-chunk bodies only: "<hex size>\r\n<payload>\r\n0\r\n"
        body = body.slice(body.indexOf('\r\n') + 2, body.lastIndexOf('\r\n0'));
      }
      resolve({ status: Number(headers.split(' ')[1]), headers, body });
    });
  });
}

describe('HTTP server', () => {
  let server: Server;
  let port: number;

  beforeAll(async () => {
    server = createHttpServer({ remoteAuth, config });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    port = (server.address() as AddressInfo).port;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  const expectHealthy = async () => {
    const res = await raw(port, `GET /health HTTP/1.1\r\nHost: 127.0.0.1:${port}\r\nConnection: close\r\n\r\n`);
    expect(res.status).toBe(200);
    expect(JSON.parse(res.body)).toMatchObject({ ok: true });
  };

  it('returns 400 for a // path and keeps serving', async () => {
    const res = await raw(port, `GET // HTTP/1.1\r\nHost: 127.0.0.1:${port}\r\nConnection: close\r\n\r\n`);
    expect(res.status).toBe(400);
    expect(res.headers.toLowerCase()).toContain('cache-control: no-store');
    expect(JSON.parse(res.body)).toEqual({ error: 'Bad request' });
    await expectHealthy();
  });

  it('returns 400 for a garbage Host header and keeps serving', async () => {
    const res = await raw(port, `GET /nope HTTP/1.1\r\nHost: not a host\r\nConnection: close\r\n\r\n`);
    expect(res.status).toBe(400);
    await expectHealthy();
  });

  it('does not crash when the Host header is missing', async () => {
    const res = await raw(port, `GET /nope HTTP/1.0\r\n\r\n`);
    expect([400, 404]).toContain(res.status);
    await expectHealthy();
  });

  it('returns 404 for an unknown path', async () => {
    const res = await raw(port, `GET /nope HTTP/1.1\r\nHost: 127.0.0.1:${port}\r\nConnection: close\r\n\r\n`);
    expect(res.status).toBe(404);
  });
});
