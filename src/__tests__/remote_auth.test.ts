import type { IncomingMessage } from 'node:http';
import { isAuthorizedDirectRequest, isSecretPath, remoteAuthConfig } from '../remote_auth.js';

describe('remote Oura MCP authentication', () => {
  const config = { bearerToken: 'b'.repeat(40), secretPath: 's'.repeat(40) };

  it('requires both strong remote credentials', () => {
    expect(() => remoteAuthConfig({ MCP_AUTH_TOKEN: '', MCP_SECRET_PATH: '' })).toThrow(/MCP_AUTH_TOKEN/);
    expect(() => remoteAuthConfig({ MCP_AUTH_TOKEN: 'b'.repeat(40), MCP_SECRET_PATH: 'short' })).toThrow(/MCP_SECRET_PATH/);
    expect(remoteAuthConfig({ MCP_AUTH_TOKEN: 'b'.repeat(40), MCP_SECRET_PATH: 's'.repeat(40) })).toEqual(config);
  });

  it('accepts only an exact bearer header for the direct endpoint', () => {
    const request = (authorization?: string) => ({ headers: { authorization } }) as IncomingMessage;
    expect(isAuthorizedDirectRequest(request(`Bearer ${config.bearerToken}`), config)).toBe(true);
    expect(isAuthorizedDirectRequest(request(config.bearerToken), config)).toBe(false);
    expect(isAuthorizedDirectRequest(request(), config)).toBe(false);
  });

  it('matches only the configured secret MCP path', () => {
    expect(isSecretPath(`/${config.secretPath}/mcp`, config)).toBe(true);
    expect(isSecretPath('/mcp', config)).toBe(false);
    expect(isSecretPath(`/${config.secretPath}/mcp?token=anything`, config)).toBe(false);
  });
});
