import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { OuraAuth } from './oura_connection.js';

export interface OuraConfig {
  personalAccessToken?: string;
  accessToken?: string;
  refreshToken?: string;
  tokenExpiresAt?: number;
  clientId?: string;
  clientSecret?: string;
  redirectUri?: string;
  debug?: boolean;
}

type EndpointKind = 'singleton' | 'collection' | 'timeSeries';
type JsonToolResult = { content: Array<{ type: 'text'; text: string }> };

interface EndpointDefinition {
  name: string;
  description: string;
  kind: EndpointKind;
  supportsDocument?: boolean;
  defaultDays?: number;
}

type ToolArgs = Record<string, unknown>;
type QueryParams = Record<string, string | boolean | number | undefined>;
type JsonToolRegistrar = {
  registerTool: (
    name: string,
    config: {
      description: string;
      inputSchema: Record<string, z.ZodTypeAny>;
      annotations: {
        readOnlyHint: boolean;
        destructiveHint: boolean;
        idempotentHint: boolean;
      };
    },
    handler: (args: ToolArgs) => Promise<JsonToolResult>,
  ) => void;
};

const DATE_OR_DATE_TIME_PATTERN =
  /^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})?)?$/;
const DATE_TIME_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})?$/;
const FIELDS_PATTERN = /^[A-Za-z0-9_,.]+$/;

const dateOrDateTime = z.string()
  .regex(DATE_OR_DATE_TIME_PATTERN, 'Use YYYY-MM-DD or an ISO-8601 datetime with timezone.');
const dateTime = z.string()
  .regex(DATE_TIME_PATTERN, 'Use an ISO-8601 datetime with timezone, for example 2026-06-08T00:00:00-07:00.');
const fields = z.string()
  .regex(FIELDS_PATTERN, 'Use a comma-separated field list with letters, numbers, underscores, commas, or dots.');
const nextToken = z.string().min(1).max(4096);
const maxPages = z.number().int().min(1).max(10);
const documentId = z.string()
  .min(1)
  .max(512)
  .refine((value) => !/[/?#]/.test(value), 'Document IDs cannot contain path separators or URL delimiters.');

const emptyInputShape: Record<string, z.ZodTypeAny> = {};

const dateCollectionInputShape: Record<string, z.ZodTypeAny> = {
  startDate: dateOrDateTime.optional().describe('Inclusive start date or datetime. Defaults to 7 days ago when no date range or nextToken is provided.'),
  endDate: dateOrDateTime.optional().describe(
    'End date or datetime. Oura semantics vary by endpoint: daily_activity, sleep, and workout are exclusive; daily_readiness, daily_sleep, daily_stress, daily_resilience, daily_cardiovascular_age, and daily_spo2 are inclusive. For sparse or unlisted endpoints, query a wider range and select the target day. Defaults to today when no date range or nextToken is provided.'
  ),
  nextToken: nextToken.optional().describe('Pagination cursor returned by a previous Oura response.'),
  fields: fields.optional().describe('Comma-separated fields to request from Oura. Omit for all fields.'),
  includeAllPages: z.boolean().optional().describe('When true, follow next_token up to maxPages. Defaults to false.'),
  maxPages: maxPages.optional().describe('Maximum pages to fetch when includeAllPages is true. Defaults to 3 and is capped at 10.'),
};

const collectionInputShape: Record<string, z.ZodTypeAny> = {
  nextToken: nextToken.optional().describe('Pagination cursor returned by a previous Oura response.'),
  fields: fields.optional().describe('Comma-separated fields to request from Oura. Omit for all fields.'),
  includeAllPages: z.boolean().optional().describe('When true, follow next_token up to maxPages. Defaults to false.'),
  maxPages: maxPages.optional().describe('Maximum pages to fetch when includeAllPages is true. Defaults to 3 and is capped at 10.'),
};

const timeSeriesInputShape: Record<string, z.ZodTypeAny> = {
  startDatetime: dateTime.optional().describe('Inclusive ISO-8601 start datetime.'),
  endDatetime: dateTime.optional().describe('Exclusive ISO-8601 end datetime.'),
  latest: z.boolean().optional().describe('When true, return the most recent sample. Defaults to true when no datetime range or nextToken is provided.'),
  nextToken: nextToken.optional().describe('Pagination cursor returned by a previous Oura response.'),
  fields: fields.optional().describe('Comma-separated fields to request from Oura. Omit for all fields.'),
  includeAllPages: z.boolean().optional().describe('When true, follow next_token up to maxPages. Defaults to false.'),
  maxPages: maxPages.optional().describe('Maximum pages to fetch when includeAllPages is true. Defaults to 3 and is capped at 10.'),
};

const documentInputShape: Record<string, z.ZodTypeAny> = {
  documentId: documentId.describe('Oura document ID returned by a collection endpoint or webhook event.'),
};

const endpoints: EndpointDefinition[] = [
  { name: 'personal_info', description: 'User profile', kind: 'singleton' },
  { name: 'ring_configuration', description: 'Ring configuration', kind: 'collection', supportsDocument: true },
  { name: 'daily_activity', description: 'Daily activity summaries', kind: 'collection', supportsDocument: true, defaultDays: 7 },
  { name: 'daily_readiness', description: 'Readiness scores', kind: 'collection', supportsDocument: true, defaultDays: 7 },
  { name: 'daily_sleep', description: 'Sleep summaries', kind: 'collection', supportsDocument: true, defaultDays: 7 },
  { name: 'sleep', description: 'Detailed sleep data', kind: 'collection', supportsDocument: true, defaultDays: 7 },
  { name: 'sleep_time', description: 'Sleep timing', kind: 'collection', supportsDocument: true, defaultDays: 7 },
  { name: 'workout', description: 'Workout data', kind: 'collection', supportsDocument: true, defaultDays: 7 },
  { name: 'session', description: 'Session data', kind: 'collection', supportsDocument: true, defaultDays: 7 },
  { name: 'daily_spo2', description: 'Blood oxygen SpO2 measurements', kind: 'collection', supportsDocument: true, defaultDays: 7 },
  { name: 'rest_mode_period', description: 'Rest mode periods', kind: 'collection', supportsDocument: true, defaultDays: 7 },
  { name: 'daily_stress', description: 'Stress metrics', kind: 'collection', supportsDocument: true, defaultDays: 7 },
  { name: 'daily_resilience', description: 'Resilience metrics', kind: 'collection', supportsDocument: true, defaultDays: 7 },
  { name: 'daily_cardiovascular_age', description: 'Cardiovascular age', kind: 'collection', supportsDocument: true, defaultDays: 7 },
  { name: 'vO2_max', description: 'VO2 max data', kind: 'collection', supportsDocument: true, defaultDays: 7 },
  { name: 'enhanced_tag', description: 'Enhanced tags with context, comments, and timing', kind: 'collection', supportsDocument: true, defaultDays: 7 },
  { name: 'tag', description: 'Deprecated legacy tags. Prefer enhanced_tag when available.', kind: 'collection', supportsDocument: true, defaultDays: 7 },
  { name: 'heartrate', description: 'Time-series heart rate samples', kind: 'timeSeries' },
  { name: 'ring_battery_level', description: 'Time-series ring battery level samples', kind: 'timeSeries' },
];

const endpointByName = new Map(endpoints.map((endpoint) => [endpoint.name, endpoint]));

export class OuraProvider {
  private server: McpServer;
  private auth: OuraAuth;
  private debug: boolean;

  constructor(config: OuraConfig) {
    this.auth = new OuraAuth({
      personalAccessToken: config.personalAccessToken,
      accessToken: config.accessToken,
      refreshToken: config.refreshToken,
      expiresAt: config.tokenExpiresAt,
      clientId: config.clientId,
      clientSecret: config.clientSecret,
      redirectUri: config.redirectUri,
    });
    this.debug = Boolean(config.debug);

    this.server = new McpServer({
      name: 'oura-provider',
      version: '1.0.0',
    });

    this.initializeResources();
  }

  private async fetchOuraData(endpointName: string, params: QueryParams = {}, documentIdValue?: string): Promise<unknown> {
    const endpoint = endpointByName.get(endpointName);
    if (!endpoint) {
      throw new Error(`Unsupported Oura endpoint: ${endpointName}`);
    }

    const headers = await this.auth.getHeaders();
    const documentPath = documentIdValue ? `/${encodeURIComponent(documentIdValue)}` : '';
    const url = new URL(`${this.auth.getBaseUrl()}/usercollection/${endpoint.name}${documentPath}`);

    for (const [key, value] of Object.entries(params)) {
      if (value === undefined || value === '') {
        continue;
      }
      url.searchParams.set(key, String(value));
    }

    this.debugLog(`GET ${url.pathname} query=[${[...url.searchParams.keys()].join(',')}]`);

    const response = await fetch(url.toString(), { headers });
    if (!response.ok) {
      throw await this.toOuraError(endpoint.name, response);
    }

    return response.json();
  }

  private async fetchWithPagination(endpointName: string, params: QueryParams, args: ToolArgs): Promise<unknown> {
    if (!this.getBoolean(args, 'includeAllPages')) {
      return this.fetchOuraData(endpointName, params);
    }

    const maxPageCount = Math.min(this.getNumber(args, 'maxPages') ?? 3, 10);
    let page = 0;
    let nextPageToken = this.getString(args, 'nextToken');
    let lastResponse: Record<string, unknown> = {};
    const data: unknown[] = [];

    do {
      const response = await this.fetchOuraData(endpointName, {
        ...params,
        next_token: nextPageToken,
      });

      if (!this.isRecord(response)) {
        return response;
      }

      lastResponse = response;
      page += 1;

      if (Array.isArray(response.data)) {
        data.push(...response.data);
      }

      nextPageToken = typeof response.next_token === 'string' && response.next_token.length > 0
        ? response.next_token
        : undefined;
    } while (nextPageToken && page < maxPageCount);

    return {
      ...lastResponse,
      data,
      next_token: nextPageToken ?? null,
      pages_fetched: page,
    };
  }

  private initializeResources(): void {
    endpoints.forEach((endpoint) => {
      this.server.registerResource(
        endpoint.name,
        `oura://${endpoint.name}`,
        {
          description: endpoint.description,
          mimeType: 'application/json',
        },
        async (uri) => {
          const data = await this.fetchOuraData(endpoint.name, this.defaultResourceParams(endpoint));

          return {
            contents: [{
              uri: uri.href,
              mimeType: 'application/json',
              text: JSON.stringify(data, null, 2),
            }],
          };
        },
      );
    });

    this.registerJsonTool(
      'get_personal_info',
      'Fetch the authenticated user profile.',
      emptyInputShape,
      async () => this.fetchOuraData('personal_info'),
    );

    endpoints
      .filter((endpoint) => endpoint.kind === 'collection')
      .forEach((endpoint) => {
        const inputShape = endpoint.defaultDays ? dateCollectionInputShape : collectionInputShape;
        this.registerJsonTool(
          `get_${endpoint.name}`,
          `Fetch ${endpoint.description}. Supports fields, nextToken, and bounded pagination.`,
          inputShape,
          async (args) => this.fetchWithPagination(
            endpoint.name,
            endpoint.defaultDays ? this.dateCollectionParams(endpoint, args) : this.collectionParams(args),
            args,
          ),
        );
      });

    endpoints
      .filter((endpoint) => endpoint.kind === 'timeSeries')
      .forEach((endpoint) => {
        this.registerJsonTool(
          `get_${endpoint.name}`,
          `Fetch ${endpoint.description}. Defaults to latest=true unless a datetime range or nextToken is provided.`,
          timeSeriesInputShape,
          async (args) => this.fetchWithPagination(endpoint.name, this.timeSeriesParams(args), args),
        );
      });

    endpoints
      .filter((endpoint) => endpoint.supportsDocument)
      .forEach((endpoint) => {
        this.registerJsonTool(
          `get_${endpoint.name}_by_id`,
          `Fetch a single ${endpoint.name} document by documentId.`,
          documentInputShape,
          async (args) => this.fetchOuraData(endpoint.name, {}, this.requireString(args, 'documentId')),
        );
      });
  }

  private registerJsonTool(
    name: string,
    description: string,
    inputSchema: Record<string, z.ZodTypeAny>,
    handler: (args: ToolArgs) => Promise<unknown>,
  ): void {
    const server = this.server as unknown as JsonToolRegistrar;

    server.registerTool(
      name,
      {
        description,
        inputSchema,
        annotations: {
          readOnlyHint: true,
          destructiveHint: false,
          idempotentHint: true,
        },
      },
      async (args) => {
        const data = await handler(args ?? {});

        return {
          content: [{
            type: 'text',
            text: JSON.stringify(data, null, 2),
          }],
        };
      },
    );
  }

  private defaultResourceParams(endpoint: EndpointDefinition): QueryParams {
    if (endpoint.kind === 'timeSeries') {
      return { latest: true };
    }

    if (endpoint.defaultDays) {
      const { startDate, endDate } = this.defaultDateRange(endpoint.defaultDays);
      return {
        start_date: startDate,
        end_date: endDate,
      };
    }

    return {};
  }

  private dateCollectionParams(endpoint: EndpointDefinition, args: ToolArgs): QueryParams {
    const params: QueryParams = {
      start_date: this.getString(args, 'startDate'),
      end_date: this.getString(args, 'endDate'),
      next_token: this.getString(args, 'nextToken'),
      fields: this.getString(args, 'fields'),
    };

    if (!params.start_date && !params.end_date && !params.next_token && endpoint.defaultDays) {
      const { startDate, endDate } = this.defaultDateRange(endpoint.defaultDays);
      params.start_date = startDate;
      params.end_date = endDate;
    }

    return params;
  }

  private collectionParams(args: ToolArgs): QueryParams {
    return {
      next_token: this.getString(args, 'nextToken'),
      fields: this.getString(args, 'fields'),
    };
  }

  private timeSeriesParams(args: ToolArgs): QueryParams {
    const params: QueryParams = {
      start_datetime: this.getString(args, 'startDatetime'),
      end_datetime: this.getString(args, 'endDatetime'),
      next_token: this.getString(args, 'nextToken'),
      latest: this.getBoolean(args, 'latest'),
      fields: this.getString(args, 'fields'),
    };

    if (!params.start_datetime && !params.end_datetime && !params.next_token && params.latest === undefined) {
      params.latest = true;
    }

    return params;
  }

  private defaultDateRange(days: number): { startDate: string; endDate: string } {
    const end = new Date();
    const start = new Date(end.getTime() - days * 24 * 60 * 60 * 1000);

    return {
      startDate: start.toISOString().split('T')[0],
      endDate: end.toISOString().split('T')[0],
    };
  }

  private async toOuraError(endpointName: string, response: Response): Promise<Error> {
    const retryAfter = response.headers.get('retry-after');
    const retryMessage = retryAfter ? ` Retry after ${retryAfter} seconds.` : '';

    return new Error(`Oura API request failed for ${endpointName}: ${response.status} ${response.statusText}.${retryMessage}`);
  }

  private debugLog(message: string): void {
    if (this.debug) {
      console.error(`[oura-mcp] ${message}`);
    }
  }

  private requireString(args: ToolArgs, key: string): string {
    const value = this.getString(args, key);
    if (!value) {
      throw new Error(`Missing required argument: ${key}`);
    }
    return value;
  }

  private getString(args: ToolArgs, key: string): string | undefined {
    const value = args[key];
    return typeof value === 'string' && value.length > 0 ? value : undefined;
  }

  private getBoolean(args: ToolArgs, key: string): boolean | undefined {
    const value = args[key];
    return typeof value === 'boolean' ? value : undefined;
  }

  private getNumber(args: ToolArgs, key: string): number | undefined {
    const value = args[key];
    return typeof value === 'number' ? value : undefined;
  }

  private isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
  }

  getServer(): McpServer {
    return this.server;
  }
}
