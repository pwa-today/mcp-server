import assert from 'node:assert/strict';
import test from 'node:test';

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';

import { createServer } from '../src/server.js';

const connect = async (auditClient) => {
  const server = createServer({ auditClient });
  const client = new Client({
    name: 'test-client',
    version: '1.0.0'
  });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

  await server.connect(serverTransport);
  await client.connect(clientTransport);

  return {
    client,
    close: async () => {
      await client.close();
    }
  };
};

test('exposes exactly the three MVP tools', async () => {
  const connection = await connect({});
  const response = await connection.client.listTools();

  assert.deepEqual(response.tools.map(({ name }) => name), [
    'start_pwa_audit',
    'get_pwa_audit_status',
    'get_pwa_audit_results'
  ]);
  await connection.close();
});

test('returns API payloads unchanged and reports a failed quality gate separately', async () => {
  const created = {
    auditId: 'audit-123',
    status: 'queued',
    reused: false,
    statusUrl: '/v1/audits/audit-123',
    resultsUrl: '/v1/audits/audit-123/results'
  };
  const audit = {
    auditId: 'audit-123',
    status: 'completed',
    score: 80,
    qualityGate: {
      passed: false
    }
  };
  const results = {
    auditId: 'audit-123',
    status: 'running',
    terminal: false,
    results: [{
      check: 'manifest',
      status: 'failed',
      severity: 'critical',
      recommendation: 'Fix the manifest.'
    }]
  };
  const connection = await connect({
    createAudit: async () => created,
    getAudit: async () => audit,
    getAuditResults: async () => results
  });
  const start = await connection.client.callTool({
    name: 'start_pwa_audit',
    arguments: {
      url: 'https://example.com',
      idempotencyKey: 'run-123'
    }
  });
  const status = await connection.client.callTool({
    name: 'get_pwa_audit_status',
    arguments: {
      auditId: 'audit-123'
    }
  });
  const result = await connection.client.callTool({
    name: 'get_pwa_audit_results',
    arguments: {
      auditId: 'audit-123'
    }
  });

  assert.deepEqual(start.structuredContent, created);
  assert.deepEqual(status.structuredContent, audit);
  assert.match(status.content[0].text, /completed.*quality gate failed/i);
  assert.deepEqual(result.structuredContent, results);
  assert.match(result.content[0].text, /1 failed/i);
  await connection.close();
});

test('returns safe tool errors without structured results', async () => {
  const connection = await connect({
    getAudit: async () => {
      throw new Error('private-token');
    }
  });
  const response = await connection.client.callTool({
    name: 'get_pwa_audit_status',
    arguments: {
      auditId: 'audit-123'
    }
  });

  assert.equal(response.isError, true);
  assert.equal(response.structuredContent, undefined);
  assert.doesNotMatch(response.content[0].text, /private-token/);
  await connection.close();
});

test('rejects malformed tool inputs before calling the API', async () => {
  let called = false;
  const connection = await connect({
    createAudit: async () => {
      called = true;
    },
    getAudit: async () => {
      called = true;
    }
  });

  const invalidUrl = await connection.client.callTool({
    name: 'start_pwa_audit',
    arguments: {
      url: 'http://example.com',
      idempotencyKey: 'run-123'
    }
  });
  const invalidAuditId = await connection.client.callTool({
    name: 'get_pwa_audit_status',
    arguments: {
      auditId: 'audit/123'
    }
  });
  const invalidIdempotencyKey = await connection.client.callTool({
    name: 'start_pwa_audit',
    arguments: {
      url: 'https://example.com',
      idempotencyKey: 'x'.repeat(201)
    }
  });

  assert.equal(invalidUrl.isError, true);
  assert.equal(invalidAuditId.isError, true);
  assert.equal(invalidIdempotencyKey.isError, true);
  assert.equal(called, false);
  await connection.close();
});
