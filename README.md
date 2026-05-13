# Oura MCP Server

A [Model Context Protocol](https://modelcontextprotocol.io/) (MCP) server for accessing [Oura Ring](https://ouraring.com/) health data.

## Prerequisites

- Node.js v18+
- An Oura account with a Personal Access Token or OAuth2 credentials

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
   - A [Personal Access Token](https://cloud.ouraring.com/personal-access-tokens) (for testing)
   - [OAuth2 Credentials](https://cloud.ouraring.com/oauth/applications) (for production)

### Environment Variables

Create a `.env` file in the project root:
```sh
# Option 1: Personal Access Token
OURA_PERSONAL_ACCESS_TOKEN=your_token

# Option 2: OAuth2 credentials
OURA_CLIENT_ID=your_client_id
OURA_CLIENT_SECRET=your_client_secret
OURA_REDIRECT_URI=http://localhost:3000/callback
```

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

## Available Tools

Each date-based resource has a corresponding `get_*` tool (e.g. `get_daily_sleep`) that accepts `startDate` and `endDate` parameters in `YYYY-MM-DD` format.
