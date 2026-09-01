import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { checkPwa } from '@pwa-today/pwa-check';

import { createAuditClient } from './audit-client.js';
import { createServer } from './server.js';
import { createTokenProvider, getConfiguration } from './token-provider.js';

export const start = async ({
  environment = process.env,
  fetchFunction = fetch
} = {}) => {
  const configuration = getConfiguration(environment);
  const tokenProvider = createTokenProvider({
    ...configuration,
    fetchFunction
  });
  const auditClient = createAuditClient({
    apiUrl: configuration.apiUrl,
    fetchFunction,
    tokenProvider
  });
  const server = createServer({ auditClient, checkPwa });

  await server.connect(new StdioServerTransport());
};
