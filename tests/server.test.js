import assert from 'node:assert/strict';
import test from 'node:test';

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';

import { createServer } from '../src/server.js';
import { AuditApiError } from '../src/audit-client.js';

const connect = async (auditClient, options = {}) => {
  const server = createServer({
    auditClient,
    ...options
  });
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

test('exposes exactly the six audit tools', async () => {
  const connection = await connect({});
  const response = await connection.client.listTools();

  assert.deepEqual(response.tools.map(({ name }) => name), [
    'start_pwa_audit',
    'get_pwa_audit_status',
    'get_pwa_audit_results',
    'list_pwa_audits',
    'compare_pwa_audits',
    'get_pwa_audit_entitlement'
  ]);
  await connection.close();
});

test('lists application audits without changing the API payload', async () => {
  const history = {
    applicationId: 'example.com',
    audits: [{
      auditId: 'audit-123',
      status: 'completed',
      score: 94,
      qualityGate: {
        passed: true
      }
    }]
  };
  let request;
  const connection = await connect({
    listApplicationAudits: async (...arguments_) => {
      request = arguments_;

      return history;
    }
  });
  const response = await connection.client.callTool({
    name: 'list_pwa_audits',
    arguments: {
      applicationId: 'EXAMPLE.COM'
    }
  });

  assert.deepEqual(request, ['example.com', 20]);
  assert.deepEqual(response.structuredContent, history);
  assert.match(response.content[0].text, /Found 1 audits.*score 94.*passed/i);
  await connection.close();
});

test('compares audits concurrently with deterministic structured differences', async () => {
  const audits = {
    'audit-before': {
      auditId: 'audit-before',
      status: 'completed',
      score: 72,
      qualityGate: { passed: false },
      profile: 'standard',
      selectedChecks: ['manifest'],
      applicationId: 'example.com',
      url: 'https://example.com/',
      versions: { engineVersion: '1', rulesetVersion: 'a' }
    },
    'audit-after': {
      auditId: 'audit-after',
      status: 'completed',
      score: 94,
      qualityGate: { passed: true },
      profile: 'standard',
      selectedChecks: ['manifest'],
      applicationId: 'example.com',
      url: 'https://example.com/',
      versions: { engineVersion: '1', rulesetVersion: 'a' }
    }
  };
  const results = {
    'audit-before': {
      terminal: true,
      results: [{ check: 'manifest', status: 'failed' }]
    },
    'audit-after': {
      terminal: true,
      results: [{ check: 'manifest', status: 'passed' }]
    }
  };
  const connection = await connect({
    getAudit: async (auditId) => audits[auditId],
    getAuditResults: async (auditId) => results[auditId]
  });
  const response = await connection.client.callTool({
    name: 'compare_pwa_audits',
    arguments: {
      baselineAuditId: 'audit-before',
      candidateAuditId: 'audit-after'
    }
  });

  assert.equal(response.structuredContent.scoreChange, 22);
  assert.equal(response.structuredContent.comparisonComplete, true);
  assert.equal(response.structuredContent.resolved[0].check, 'manifest');
  assert.match(response.content[0].text, /improved by 22/i);
  await connection.close();
});

test('rejects identical audit IDs without calling the API', async () => {
  let called = false;
  const connection = await connect({
    getAudit: async () => {
      called = true;
    },
    getAuditResults: async () => {
      called = true;
    }
  });
  const response = await connection.client.callTool({
    name: 'compare_pwa_audits',
    arguments: {
      baselineAuditId: 'audit-123',
      candidateAuditId: 'audit-123'
    }
  });

  assert.equal(response.isError, true);
  assert.equal(called, false);
  await connection.close();
});

test('returns the entitlement API payload unchanged', async () => {
  const entitlement = {
    plan: 'developer',
    available: true,
    auditType: 'standard',
    auditLimit: 100,
    auditsRemaining: 62,
    applicationsUsed: 2,
    applicationLimit: 3
  };
  const connection = await connect({
    getAuditEntitlement: async () => entitlement
  });
  const response = await connection.client.callTool({
    name: 'get_pwa_audit_entitlement',
    arguments: {}
  });

  assert.deepEqual(response.structuredContent, entitlement);
  assert.match(response.content[0].text, /62 of 100 audits remain/i);
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
  let idempotencyKey;
  const connection = await connect({
    createAudit: async (request, key) => {
      idempotencyKey = key;

      return created;
    },
    getAudit: async () => audit,
    getAuditResults: async () => results
  }, {
    createId: () => 'generated-key'
  });
  const start = await connection.client.callTool({
    name: 'start_pwa_audit',
    arguments: {
      url: 'https://example.com'
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
  assert.equal(idempotencyKey, 'generated-key');
  assert.match(start.content[0].text, /Idempotency key: generated-key/);
  assert.deepEqual(status.structuredContent, audit);
  assert.match(status.content[0].text, /completed.*quality gate failed/i);
  assert.deepEqual(result.structuredContent, results);
  assert.match(result.content[0].text, /1 failed/i);
  await connection.close();
});

test('returns the generated idempotency key when creation outcome is unknown', async () => {
  const connection = await connect({
    createAudit: async () => {
      throw new AuditApiError('The outcome may be unknown.');
    }
  }, {
    createId: () => 'generated-key'
  });
  const response = await connection.client.callTool({
    name: 'start_pwa_audit',
    arguments: {
      url: 'https://example.com'
    }
  });

  assert.equal(response.isError, true);
  assert.match(response.content[0].text, /idempotency key generated-key/i);
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
