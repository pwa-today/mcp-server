import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import { AuditApiError } from './audit-client.js';

const auditIdSchema = z.string()
  .min(1)
  .max(200)
  .regex(/^[A-Za-z0-9_-]+$/, 'auditId must contain only letters, numbers, hyphens, and underscores.');

const urlSchema = z.string()
  .max(2048)
  .refine((value) => {
    try {
      const url = new URL(value);

      return url.protocol === 'https:' && !url.username && !url.password && (!url.port || url.port === '443');
    }
    catch {
      return false;
    }
  }, 'url must be a public HTTPS URL without credentials or a custom port.');

const sourceSchema = z.object({
  type: z.string().max(2048).optional(),
  provider: z.string().max(2048).optional(),
  repository: z.string().max(2048).optional(),
  branch: z.string().max(2048).optional(),
  commit: z.string().max(2048).optional(),
  pullRequest: z.string().max(2048).optional(),
  pipelineUrl: z.string().max(2048).optional(),
  environment: z.string().max(2048).optional(),
  cliVersion: z.string().max(2048).optional()
});

const startAuditSchema = {
  url: urlSchema,
  applicationId: z.string().regex(/^[a-zA-Z0-9.-]{1,253}$/).optional(),
  profile: z.enum(['quick', 'standard', 'full', 'custom']).optional(),
  include: z.array(z.string()).optional(),
  exclude: z.array(z.string()).optional(),
  options: z.record(z.string(), z.unknown()).optional(),
  qualityGate: z.object({
    minimumScore: z.number().min(0).max(100).optional(),
    failOn: z.array(z.enum(['critical', 'high', 'medium', 'low'])).optional(),
    failOnWarnings: z.boolean().optional()
  }).optional(),
  source: sourceSchema.optional(),
  idempotencyKey: z.string().min(1).max(200)
};

const toolError = (error) => {
  const retryAfter = error instanceof AuditApiError && error.retryAfter
    ? ` Retry after ${error.retryAfter}.`
    : '';
  const message = error instanceof AuditApiError
    ? error.message
    : 'The PWA Today MCP server could not complete the request.';

  return {
    content: [{
      type: 'text',
      text: `${message}${retryAfter}`
    }],
    isError: true
  };
};

const resultSummary = (result) => {
  const counts = result.results.reduce((summary, check) => {
    summary[check.status] = (summary[check.status] ?? 0) + 1;

    return summary;
  }, {});
  const failed = (counts.failed ?? 0) + (counts.error ?? 0);
  const countText = Object.entries(counts)
    .map(([status, count]) => `${count} ${status}`)
    .join(', ') || 'no persisted checks';

  return `${result.status}; ${countText}. ${failed > 0 ? `${failed} failed or error check${failed === 1 ? '' : 's'} require attention.` : 'No failed or error checks.'}`;
};

export const createServer = ({ auditClient }) => {
  const server = new McpServer({
    name: '@pwa-today/mcp-server',
    version: '0.1.0'
  });

  server.registerTool('start_pwa_audit', {
    description: 'Starts an automated browser-based PWA Today runtime audit for a verified application. This consumes one audit from the customer\'s current allowance. It returns immediately with an audit ID; use the status and results tools to follow completion.',
    inputSchema: startAuditSchema,
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true
    }
  }, async ({ idempotencyKey, ...request }) => {
    try {
      const created = await auditClient.createAudit(request, idempotencyKey);
      const state = created.reused ? 'reused' : 'queued';

      return {
        content: [{
          type: 'text',
          text: `Audit ${state}. Allowance consumption follows existing PWA Today API behavior.`
        }],
        structuredContent: created
      };
    }
    catch (error) {
      return toolError(error);
    }
  });

  server.registerTool('get_pwa_audit_status', {
    description: 'Retrieves execution status and quality-gate state for a PWA Today runtime audit.',
    inputSchema: {
      auditId: auditIdSchema
    },
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true
    }
  }, async ({ auditId }) => {
    try {
      const audit = await auditClient.getAudit(auditId);
      const score = audit.score === null || audit.score === undefined ? 'score pending' : `score ${audit.score}`;
      const qualityGate = audit.qualityGate?.passed === undefined ? 'quality gate pending' : `quality gate ${audit.qualityGate.passed ? 'passed' : 'failed'}`;
      const polling = ['queued', 'running'].includes(audit.status) ? 'Continue polling.' : 'Polling is complete.';

      return {
        content: [{
          type: 'text',
          text: `${audit.status}; ${score}; ${qualityGate}. ${polling}`
        }],
        structuredContent: audit
      };
    }
    catch (error) {
      return toolError(error);
    }
  });

  server.registerTool('get_pwa_audit_results', {
    description: 'Retrieves persisted ordered PWA Today runtime audit check results, including partial results while an audit is running.',
    inputSchema: {
      auditId: auditIdSchema
    },
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true
    }
  }, async ({ auditId }) => {
    try {
      const results = await auditClient.getAuditResults(auditId);

      return {
        content: [{
          type: 'text',
          text: resultSummary(results)
        }],
        structuredContent: results
      };
    }
    catch (error) {
      return toolError(error);
    }
  });

  return server;
};
