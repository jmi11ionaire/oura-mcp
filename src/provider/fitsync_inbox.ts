/**
 * FitSync Inbox write-through proxy.
 *
 * claude.ai chat sessions cannot fetch script.google.com directly
 * (robots-blocked in the chat environment), so chat-banked food logs need a
 * server this MCP deployment can reach on their behalf. This tool does a
 * server-side POST to the existing FitSync Apps Script inbox endpoint and
 * returns its JSON verbatim. No storage, no parsing, no math here — the
 * Google Sheet stays the single source of truth.
 *
 * Capture only: this module must never call action=sync or any other
 * FitSync action.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

const DEFAULT_INBOX_URL =
  'https://script.google.com/macros/s/AKfycbxYnJl2e0sO8Hp7CrxVC5NjwOpJQCh-jOCAm0UsNvpkQYDYMcmbJEPmAYMmD2Dn4bspqg/exec';

export interface BankInboxParams {
  text: string;
  date: string;
  entryId: string;
  source?: string;
}

/**
 * POST the entry to the Apps Script endpoint. Apps Script answers POSTs with
 * a 302 to a one-time script.googleusercontent.com URL that serves the JSON
 * response; automatic redirect-following mangles that hop (observed with
 * curl -L), so follow it manually: the write is processed before the
 * redirect, and the Location target is fetched with a plain GET.
 */
export async function postInboxEntry(
  params: BankInboxParams,
  endpointUrl: string = process.env.FITSYNC_INBOX_URL || DEFAULT_INBOX_URL,
  inboxToken: string = process.env.FITSYNC_INBOX_TOKEN || '',
): Promise<string> {
  const body: Record<string, string> = {
    action: 'inbox',
    text: params.text,
    date: params.date,
    entryId: params.entryId,
    timestamp: new Date().toISOString(),
    source: params.source || 'chat',
  };
  if (inboxToken) {
    body.token = inboxToken;
  }

  const response = await fetch(endpointUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    redirect: 'manual',
  });

  if (response.status >= 300 && response.status < 400) {
    const location = response.headers.get('location');
    if (!location) {
      throw new Error(`FitSync inbox endpoint redirected (${response.status}) without a Location header.`);
    }
    const redirected = await fetch(location, { redirect: 'follow' });
    const text = await redirected.text();
    if (!redirected.ok) {
      throw new Error(`FitSync inbox redirect target returned ${redirected.status}: ${text.slice(0, 200)}`);
    }
    return text;
  }

  const text = await response.text();
  if (!response.ok) {
    throw new Error(`FitSync inbox endpoint returned ${response.status}: ${text.slice(0, 200)}`);
  }
  return text;
}

type ToolArgs = Record<string, unknown>;
type JsonToolResult = { content: Array<{ type: 'text'; text: string }> };
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

const inboxInputShape: Record<string, z.ZodTypeAny> = {
  text: z.string().min(1).max(2000).describe(
    'Raw food/activity description including estimated macros, e.g. "tuna sandwich, chips (620 cal, 32p/55c/28f/900mg)". Stored verbatim; parsed at closeout, never here.',
  ),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD.').describe(
    'Effective date the food belongs to (YYYY-MM-DD, Pacific Time day).',
  ),
  entryId: z.string().regex(
    /^[A-Za-z0-9._-]{6,128}$/,
    'Use 6-128 chars: letters, numbers, dot, underscore, hyphen.',
  ).describe(
    'Unique idempotency key, convention "chat-YYYYMMDD-<3 alphanum>-<seq>". Replaying the same entryId returns duplicate:true and never writes a second row.',
  ),
  source: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/).optional().describe(
    'Capture source label. Defaults to "chat".',
  ),
};

export function registerFitSyncInboxTool(server: McpServer): void {
  const registrar = server as unknown as JsonToolRegistrar;

  registrar.registerTool(
    'bank_inbox_entry',
    {
      description:
        'Bank a raw food/activity log entry into the FitSync Inbox (Jesse\'s Google Sheet) via the Apps Script endpoint. '
        + 'Write-through proxy: capture only, no parsing or macro math. Idempotent on entryId. '
        + 'Returns the endpoint\'s JSON verbatim so the caller can confirm the row landed or see duplicate:true.',
      inputSchema: inboxInputShape,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
      },
    },
    async (args) => {
      const text = await postInboxEntry({
        text: String(args.text ?? ''),
        date: String(args.date ?? ''),
        entryId: String(args.entryId ?? ''),
        source: typeof args.source === 'string' && args.source.length > 0 ? args.source : undefined,
      });

      return {
        content: [{ type: 'text', text }],
      };
    },
  );
}
