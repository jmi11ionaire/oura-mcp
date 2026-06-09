import { jest } from '@jest/globals';
import { OuraAuth } from '../provider/oura_connection.js';
import { OuraProvider } from '../provider/oura_provider.js';

type RegisteredTool = {
  handler: (args: Record<string, unknown>) => Promise<{ content: Array<{ type: 'text'; text: string }> }>;
};

function registeredTools(provider: OuraProvider): Record<string, RegisteredTool> {
  return (provider.getServer() as unknown as { _registeredTools: Record<string, RegisteredTool> })._registeredTools;
}

describe('OuraProvider', () => {
  let fetchMock: jest.MockedFunction<typeof fetch>;

  beforeEach(() => {
    fetchMock = jest.fn<typeof fetch>();
    global.fetch = fetchMock;
  });

  it('registers read-only v2 collection, time-series, and document tools', () => {
    const provider = new OuraProvider({ personalAccessToken: 'pat-token' });
    const tools = registeredTools(provider);

    expect(tools).toHaveProperty('get_daily_sleep');
    expect(tools).toHaveProperty('get_daily_sleep_by_id');
    expect(tools).toHaveProperty('get_enhanced_tag');
    expect(tools).toHaveProperty('get_heartrate');
    expect(tools).toHaveProperty('get_ring_battery_level');
    expect(tools).toHaveProperty('get_personal_info');
  });

  it('uses bounded date queries, pagination, and field selection for collection tools', async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ data: [], next_token: null }), { status: 200 }));

    const provider = new OuraProvider({ personalAccessToken: 'pat-token' });
    await registeredTools(provider).get_daily_sleep.handler({
      startDate: '2026-06-01',
      endDate: '2026-06-08',
      fields: 'day,score',
      nextToken: 'cursor-1',
    });

    const { url: requestUrl, init } = fetchCall(0);
    expect(requestUrl.pathname).toBe('/v2/usercollection/daily_sleep');
    expect(requestUrl.searchParams.get('start_date')).toBe('2026-06-01');
    expect(requestUrl.searchParams.get('end_date')).toBe('2026-06-08');
    expect(requestUrl.searchParams.get('fields')).toBe('day,score');
    expect(requestUrl.searchParams.get('next_token')).toBe('cursor-1');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer pat-token');
  });

  it('defaults time-series tools to latest=true when no range is provided', async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ data: [] }), { status: 200 }));

    const provider = new OuraProvider({ personalAccessToken: 'pat-token' });
    await registeredTools(provider).get_heartrate.handler({});

    const { url: requestUrl } = fetchCall(0);
    expect(requestUrl.pathname).toBe('/v2/usercollection/heartrate');
    expect(requestUrl.searchParams.get('latest')).toBe('true');
  });

  it('can follow bounded pagination for collection tools', async () => {
    fetchMock
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: [{ id: 'first' }], next_token: 'cursor-2' }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: [{ id: 'second' }], next_token: null }), { status: 200 }));

    const provider = new OuraProvider({ personalAccessToken: 'pat-token' });
    const result = await registeredTools(provider).get_daily_sleep.handler({
      startDate: '2026-06-01',
      endDate: '2026-06-08',
      includeAllPages: true,
      maxPages: 2,
    });

    const data = JSON.parse(result.content[0].text);
    expect(data.data).toEqual([{ id: 'first' }, { id: 'second' }]);
    expect(data.pages_fetched).toBe(2);
    expect(fetchCall(1).url.searchParams.get('next_token')).toBe('cursor-2');
  });

  it('fetches document endpoints with encoded document IDs', async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ id: 'doc:1' }), { status: 200 }));

    const provider = new OuraProvider({ personalAccessToken: 'pat-token' });
    await registeredTools(provider).get_sleep_by_id.handler({ documentId: 'doc:1' });

    const { url: requestUrl } = fetchCall(0);
    expect(requestUrl.pathname).toBe('/v2/usercollection/sleep/doc%3A1');
  });

  it('refreshes OAuth tokens with client credentials when the access token is missing', async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({
      access_token: 'new-access-token',
      refresh_token: 'new-refresh-token',
      expires_in: 3600,
    }), { status: 200 }));

    const auth = new OuraAuth({
      refreshToken: 'refresh-token',
      clientId: 'client-id',
      clientSecret: 'client-secret',
    });

    const headers = await auth.getHeaders();

    expect(headers.Authorization).toBe('Bearer new-access-token');
    const { input, init } = fetchCall(0);
    expect(input).toBe('https://api.ouraring.com/oauth/token');
    expect(String(init.body)).toContain('client_id=client-id');
    expect(String(init.body)).toContain('client_secret=client-secret');
  });

  function fetchCall(index: number): { input: string; url: URL; init: RequestInit } {
    const [input, init = {}] = fetchMock.mock.calls[index];
    const inputString = typeof input === 'string'
      ? input
      : input instanceof URL
        ? input.toString()
        : input.url;

    return {
      input: inputString,
      url: new URL(inputString),
      init,
    };
  }
});
