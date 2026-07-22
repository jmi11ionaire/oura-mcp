# Oura MCP Server

A [Model Context Protocol](https://modelcontextprotocol.io/) (MCP) server for accessing [Oura Ring](https://ouraring.com/) health data.

## Prerequisites

- Node.js v18+
- An Oura account with a Personal Access Token or OAuth2 access token

## Installation

1. Clone the repository
2. Install dependencies and build:
```sh
npm install
npm run build
```

## Configuration

### Obtaining Credentials

1. Log in to the [Oura Cloud Console](https://cloud.ouraring.com/)
2. Get either:
   - A [Personal Access Token](https://cloud.ouraring.com/personal-access-tokens)
   - An OAuth2 access token, optionally with a refresh token and app credentials

### Environment Variables

Create a `.env` file in the project root:
```sh
# Option 1: Personal Access Token
OURA_PERSONAL_ACCESS_TOKEN=your_token

# Option 2: OAuth2 token
OURA_ACCESS_TOKEN=your_access_token
OURA_REFRESH_TOKEN=your_refresh_token
OURA_TOKEN_EXPIRES_AT=1735689600000
OURA_CLIENT_ID=your_client_id
OURA_CLIENT_SECRET=your_client_secret

# Optional diagnostics. Logs request paths and query keys to stderr only.
OURA_DEBUG=false

# Required for the remote HTTP deployment
MCP_AUTH_TOKEN=a-random-secret-of-at-least-32-characters
MCP_SECRET_PATH=a-separate-url-safe-secret-of-at-least-32-characters
```

Remote deployments fail closed unless both MCP credentials are present. FitSync
uses `POST /mcp` with the bearer token. Claude may use the separate secret-path
URL. Query-string tokens and an open root endpoint are not supported. Oura
tools are read-only. Jesse's deployment also keeps the separate
`bank_inbox_entry` tool for the manual Google Sheet workflow; Amanda's Fly
configuration disables that tool so it cannot reach Jesse's Sheet.

## Usage

### Claude Desktop Integration

Add to Claude Desktop's config (Settings → Developer → Edit Config):
```json
{
  "mcpServers": {
    "oura": {
      "command": "node",
      "args": ["/absolute/path/to/oura-mcp/build/index.js"],
      "env": { "OURA_PERSONAL_ACCESS_TOKEN": "your_token" }
    }
  }
}
```
Restart Claude Desktop after saving. See the [MCP quickstart](https://modelcontextprotocol.io/quickstart/user) for details.

### Manual Testing

```sh
node test.js <tool_name> <date>
```
Example: `node test.js get_daily_sleep 2025-05-01`

## Available Resources

Resources are accessible via MCP `readResource` calls (e.g. `oura://personal_info`). Date-based resources return the last 7 days by default.

| Resource | Description |
|---|---|
| `personal_info` | User profile |
| `ring_configuration` | Ring configuration |
| `daily_activity` | Daily activity summaries |
| `daily_readiness` | Readiness scores |
| `daily_sleep` | Sleep summaries |
| `sleep` | Detailed sleep data |
| `sleep_time` | Sleep timing |
| `workout` | Workout data |
| `session` | Session data |
| `daily_spo2` | Blood oxygen (SpO2) measurements |
| `rest_mode_period` | Rest mode periods |
| `daily_stress` | Stress metrics |
| `daily_resilience` | Resilience metrics |
| `daily_cardiovascular_age` | Cardiovascular age |
| `vO2_max` | VO2 max data |
| `enhanced_tag` | Enhanced tags with context, comments, and timing |
| `tag` | Deprecated legacy tags |
| `heartrate` | Time-series heart rate samples |
| `ring_battery_level` | Time-series ring battery level samples |

## Available Tools

Each resource has a corresponding `get_*` tool (e.g. `get_daily_sleep`). Collection tools accept:

- `startDate` and `endDate` in `YYYY-MM-DD` or ISO-8601 datetime format. Date-based tools default to the last 7 days when no date range or `nextToken` is provided.
- `fields` as a comma-separated field list to reduce payload size.
- `nextToken` to fetch the next Oura page.
- `includeAllPages` and `maxPages` to follow pagination in one call. `maxPages` is capped at 10.

Time-series tools (`get_heartrate`, `get_ring_battery_level`) accept `startDatetime`, `endDatetime`, `latest`, `fields`, `nextToken`, `includeAllPages`, and `maxPages`. They default to `latest=true` when no datetime range or `nextToken` is provided.

Document endpoints are exposed as `get_<resource>_by_id` tools, for example `get_sleep_by_id` with `{ "documentId": "..." }`.
