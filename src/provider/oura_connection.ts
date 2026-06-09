export interface OuraTokens {
  accessToken?: string;
  refreshToken?: string;
  expiresAt?: number;
}

export interface OuraAuthConfig extends OuraTokens {
  personalAccessToken?: string;
  clientId?: string;
  clientSecret?: string;
  redirectUri?: string;
}

export class OuraAuth {
  private baseUrl = 'https://api.ouraring.com/v2';
  private tokens: OuraTokens;
  private clientId?: string;
  private clientSecret?: string;

  constructor(config: OuraAuthConfig) {
    this.clientId = config.clientId;
    this.clientSecret = config.clientSecret;
    this.tokens = {
      accessToken: config.personalAccessToken || config.accessToken,
      refreshToken: config.refreshToken,
      expiresAt: config.expiresAt,
    };

    if (!this.tokens.accessToken && !this.tokens.refreshToken) {
      throw new Error(
        'Set OURA_PERSONAL_ACCESS_TOKEN, or set OURA_ACCESS_TOKEN. For OAuth refresh, also set OURA_REFRESH_TOKEN, OURA_CLIENT_ID, and OURA_CLIENT_SECRET.',
      );
    }
  }

  async getHeaders(): Promise<Record<string, string>> {
    if (this.shouldRefresh()) {
      await this.refreshTokens();
    }

    if (!this.tokens.accessToken) {
      throw new Error('Not authenticated: no Oura access token is available.');
    }

    return {
      Authorization: `Bearer ${this.tokens.accessToken}`,
      Accept: 'application/json',
    };
  }

  private shouldRefresh(): boolean {
    if (!this.tokens.refreshToken) {
      return false;
    }

    if (!this.tokens.accessToken) {
      return true;
    }

    return typeof this.tokens.expiresAt === 'number' && this.tokens.expiresAt <= Date.now();
  }

  private async refreshTokens(): Promise<void> {
    if (!this.tokens.refreshToken) {
      throw new Error('No Oura refresh token available.');
    }

    if (!this.clientId || !this.clientSecret) {
      throw new Error('OURA_CLIENT_ID and OURA_CLIENT_SECRET are required to refresh OAuth tokens.');
    }

    const response = await fetch('https://api.ouraring.com/oauth/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json',
      },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: this.tokens.refreshToken,
        client_id: this.clientId,
        client_secret: this.clientSecret,
      }),
    });

    if (!response.ok) {
      throw new Error(`Failed to refresh Oura token: ${response.status} ${response.statusText}`);
    }

    const data = await response.json() as {
      access_token?: string;
      refresh_token?: string;
      expires_in?: number;
    };

    if (!data.access_token) {
      throw new Error('Oura token refresh response did not include an access_token.');
    }

    this.tokens = {
      accessToken: data.access_token,
      refreshToken: data.refresh_token || this.tokens.refreshToken,
      expiresAt: typeof data.expires_in === 'number'
        ? Date.now() + data.expires_in * 1000
        : undefined,
    };
  }

  getBaseUrl(): string {
    return this.baseUrl;
  }
}
