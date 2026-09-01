import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import test from 'node:test';

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const json = (response, status, body) => {
  response.writeHead(status, {
    'content-type': 'application/json'
  });
  response.end(JSON.stringify(body));
};

test('runs generic-check and audit tools through a stdio MCP server', async () => {
  const requests = [];
  const api = createServer((request, response) => {
    let body = '';

    request.on('data', (chunk) => {
      body += chunk;
    });
    request.on('end', () => {
      requests.push({
        authorization: request.headers.authorization,
        body,
        idempotencyKey: request.headers['idempotency-key'],
        method: request.method,
        url: request.url
      });

      if (request.url === '/token') {
        json(response, 200, {
          access_token: 'test-access-token',
          expires_in: 3600,
          token_type: 'Bearer'
        });
        return;
      }

      if (request.method === 'POST' && request.url === '/v1/audits') {
        json(response, 202, {
          auditId: 'audit-123',
          status: 'queued',
          reused: false,
          statusUrl: '/v1/audits/audit-123',
          resultsUrl: '/v1/audits/audit-123/results'
        });
        return;
      }

      if (request.url === '/v1/audits/audit-123') {
        json(response, 200, {
          auditId: 'audit-123',
          status: 'completed',
          score: 80,
          qualityGate: {
            passed: false
          }
        });
        return;
      }

      if (request.url === '/v1/audits/audit-456') {
        json(response, 200, {
          auditId: 'audit-456',
          status: 'completed',
          score: 100,
          qualityGate: {
            passed: true
          },
          profile: 'standard',
          selectedChecks: ['manifest'],
          applicationId: 'example.com',
          url: 'https://example.com/',
          versions: {
            engineVersion: '1.0.0',
            rulesetVersion: '2026.08'
          }
        });
        return;
      }

      if (request.url === '/v1/audits/audit-123/results') {
        json(response, 200, {
          auditId: 'audit-123',
          status: 'completed',
          terminal: true,
          results: [{
            check: 'manifest',
            status: 'failed',
            severity: 'critical',
            recommendation: 'Fix the manifest.'
          }]
        });
        return;
      }

      if (request.url === '/v1/audits/audit-456/results') {
        json(response, 200, {
          auditId: 'audit-456',
          status: 'completed',
          terminal: true,
          results: [{
            check: 'manifest',
            status: 'passed',
            severity: 'critical'
          }]
        });
        return;
      }

      if (request.url === '/v1/applications/example.com/audits?limit=20') {
        json(response, 200, {
          applicationId: 'example.com',
          audits: [{
            auditId: 'audit-456',
            status: 'completed',
            score: 100,
            qualityGate: {
              passed: true
            }
          }]
        });
        return;
      }

      if (request.url === '/v1/entitlement') {
        json(response, 200, {
          plan: 'developer',
          available: true,
          auditType: 'standard',
          auditLimit: 100,
          auditsRemaining: 62,
          applicationsUsed: 2,
          applicationLimit: 3
        });
        return;
      }

      json(response, 404, {
        error: 'Not found.'
      });
    });
  });
  await new Promise((resolve) => {
    api.listen(0, '127.0.0.1', resolve);
  });
  const address = api.address();
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ['bin/pwa-today-mcp.js'],
    cwd: new URL('..', import.meta.url).pathname,
    env: {
      PWA_API_URL: `http://127.0.0.1:${address.port}`,
      PWA_CLIENT_ID: 'test-client-id',
      PWA_CLIENT_SECRET: 'test-client-secret'
    },
    stderr: 'pipe'
  });
  const stderr = [];
  transport.stderr?.on('data', (chunk) => {
    stderr.push(chunk.toString());
  });
  const client = new Client({
    name: 'stdio-test-client',
    version: '1.0.0'
  });

  try {
    await client.connect(transport);
    const tools = await client.listTools();
    const start = await client.callTool({
      name: 'start_pwa_audit',
      arguments: {
        url: 'https://example.com'
      }
    });
    const status = await client.callTool({
      name: 'get_pwa_audit_status',
      arguments: {
        auditId: 'audit-123'
      }
    });
    const results = await client.callTool({
      name: 'get_pwa_audit_results',
      arguments: {
        auditId: 'audit-123'
      }
    });
    const history = await client.callTool({
      name: 'list_pwa_audits',
      arguments: {
        applicationId: 'example.com'
      }
    });
    const comparison = await client.callTool({
      name: 'compare_pwa_audits',
      arguments: {
        baselineAuditId: 'audit-123',
        candidateAuditId: 'audit-456'
      }
    });
    const entitlement = await client.callTool({
      name: 'get_pwa_audit_entitlement',
      arguments: {}
    });

    assert.equal(tools.tools.length, 7);
    assert.equal(start.structuredContent.auditId, 'audit-123');
    assert.match(status.content[0].text, /quality gate failed/i);
    assert.equal(results.structuredContent.terminal, true);
    assert.equal(history.structuredContent.audits[0].auditId, 'audit-456');
    assert.equal(comparison.structuredContent.resolved[0].check, 'manifest');
    assert.equal(entitlement.structuredContent.auditsRemaining, 62);
    assert.equal(requests[0].authorization, 'Basic dGVzdC1jbGllbnQtaWQ6dGVzdC1jbGllbnQtc2VjcmV0');
    assert.match(requests[1].idempotencyKey, /^[a-f0-9-]{36}$/);
    assert.doesNotMatch(requests[1].body, /test-access-token/);
    assert.equal(stderr.join(''), '');
  }
  finally {
    await client.close();
    await new Promise((resolve, reject) => {
      api.close((error) => error ? reject(error) : resolve());
    });
  }
});
