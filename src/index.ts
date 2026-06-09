import { config as dotenvConfig } from 'dotenv';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { OuraProvider } from './provider/oura_provider.js';

dotenvConfig();

const config = {
  api: {
    baseUrl: 'https://api.ouraring.com/v2',
  },
  auth: {
    personalAccessToken: process.env.OURA_PERSONAL_ACCESS_TOKEN || '',
    accessToken: process.env.OURA_ACCESS_TOKEN || '',
    refreshToken: process.env.OURA_REFRESH_TOKEN || '',
    tokenExpiresAt: parseOptionalNumber(process.env.OURA_TOKEN_EXPIRES_AT),
    clientId: process.env.OURA_CLIENT_ID || '',
    clientSecret: process.env.OURA_CLIENT_SECRET || '',
    redirectUri: process.env.OURA_REDIRECT_URI || 'http://localhost:3000/callback'
  },
  debug: process.env.OURA_DEBUG === 'true',
  server: {
    name: 'oura-provider',
    version: '1.0.0'
  }
};

function validateConfig() {
  const { personalAccessToken, accessToken, refreshToken, clientId, clientSecret } = config.auth;
  
  if (personalAccessToken || accessToken) {
    return;
  }

  if (refreshToken && clientId && clientSecret) {
    return;
  }

  throw new Error('Set OURA_PERSONAL_ACCESS_TOKEN, or set OURA_ACCESS_TOKEN. For OAuth refresh, also set OURA_REFRESH_TOKEN, OURA_CLIENT_ID, and OURA_CLIENT_SECRET.');
}

function parseOptionalNumber(value: string | undefined): number | undefined {
  if (!value) {
    return undefined;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

async function main() {
  // Validate configuration
  validateConfig();

  // Create and initialize the provider
  const provider = new OuraProvider({
    personalAccessToken: config.auth.personalAccessToken,
    accessToken: config.auth.accessToken,
    refreshToken: config.auth.refreshToken,
    tokenExpiresAt: config.auth.tokenExpiresAt,
    clientId: config.auth.clientId,
    clientSecret: config.auth.clientSecret,
    redirectUri: config.auth.redirectUri,
    debug: config.debug
  });
  
  const transport = new StdioServerTransport();
  
  await provider.getServer().connect(transport);
}

main().catch(error => {
  console.error('Server error:', error);
  process.exit(1);
});
