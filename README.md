# PWA Today MCP Server

Run PWA Today runtime audits from an MCP-compatible coding agent.

> Never paste your PWA Today client secret or access token into a chat. Store it in your MCP client's secret or environment configuration. The model does not need to see it.

## Setup

1. Create or retrieve API credentials in [the PWA Today console](https://console.pwa.today/dashboard/credentials/).
2. Register and verify the application hostname in the console.
3. Install the package or configure your MCP client to run `pwa-today-mcp`.
4. Store `PWA_CLIENT_ID` and `PWA_CLIENT_SECRET` in the server environment. Optionally set `PWA_API_URL`; it defaults to `https://api.pwa.today`.
5. Restart or reconnect your MCP client.
6. Ask your agent to start an audit.

The server uses stdio only and exposes these tools:

- `start_pwa_audit`
- `get_pwa_audit_status`
- `get_pwa_audit_results`
- `list_pwa_audits`
- `compare_pwa_audits`
- `get_pwa_audit_entitlement`

Example requests:

```text
Run a standard PWA Today audit on https://staging.example.com. Use this repository and commit as source metadata. Show me the result when it finishes.
```

```text
Review audit <auditId>, map every failed or warning check to this codebase, and propose a minimal fix plan. Do not edit files yet.
```

```text
After the deployment is live, run the audit again and compare the quality gate and failed checks.
```

```text
List the 10 most recent audits for example.com and identify the latest completed run.
```

```text
Compare these two audit IDs: [baseline audit id] and [candidate audit id]. Tell me which checks resolved, which regressed, and whether the comparison used the same ruleset.
```

```text
Check my PWA Today entitlement before starting an audit. Do not start one yet.
```

The server creates an idempotency key for each new audit and reports it with the audit ID. If creation has an unknown outcome, retry with that same key. The MCP package does not accept audited-application authentication or deploy applications.

Listing audits, comparing audits, and retrieving entitlement do not consume allowance. Starting an audit can reserve or consume allowance according to existing API behavior. Comparison reports observed result differences; it does not prove that a particular code or deployment change caused them.
