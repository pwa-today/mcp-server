import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createAuditClient
} from '../src/audit-client.js';
import {
  createTokenProvider,
  getConfiguration
} from '../src/token-provider.js';

const jsonResponse = (status, body, headers = {}) => {
  return new Response(JSON.stringify(body), {
    headers: {
      'content-type': 'application/json',
      ...headers
    },
    status
  });
};

test('reads credentials only from the environment boundary', () => {
  assert.deepEqual(getConfiguration({
    PWA_CLIENT_ID: 'client-id',
    PWA_CLIENT_SECRET: 'client-secret'
  }), {
    apiUrl: 'https://api.pwa.today',
    clientId: 'client-id',
    clientSecret: 'client-secret'
  });
  assert.throws(() => getConfiguration({}), /PWA_CLIENT_ID/);
});

test('exchanges and caches tokens using the API lifetime', async () => {
  let now = 0;
  const requests = [];
  const provider = createTokenProvider({
    apiUrl: 'https://api.example.com',
    clientId: 'client-id',
    clientSecret: 'client-secret',
    fetchFunction: async (url, options) => {
      requests.push({ url, options });

      return jsonResponse(200, {
        access_token: `token-${requests.length}`,
        expires_in: 60,
        token_type: 'Bearer'
      });
    },
    now: () => now
  });

  assert.equal(await provider.getAccessToken(), 'token-1');
  now = 29_999;
  assert.equal(await provider.getAccessToken(), 'token-1');
  now = 30_000;
  assert.equal(await provider.getAccessToken(), 'token-2');
  assert.equal(requests.length, 2);
  assert.equal(requests[0].options.headers.authorization, 'Basic Y2xpZW50LWlkOmNsaWVudC1zZWNyZXQ=');
  assert.equal(requests[0].options.body.toString(), 'grant_type=client_credentials&scope=https%3A%2F%2Fapi.pwa.today%2Fchecks.run');
});

test('refreshes once after a 401 and forwards an idempotency key only as a header', async () => {
  const tokens = ['expired-token', 'fresh-token'];
  let invalidated = 0;
  const requests = [];
  const client = createAuditClient({
    apiUrl: 'https://api.example.com',
    tokenProvider: {
      getAccessToken: async () => tokens.shift(),
      invalidate: () => {
        invalidated += 1;
      }
    },
    fetchFunction: async (url, options) => {
      requests.push({ url, options });

      return requests.length === 1
        ? jsonResponse(401, { error: 'Unauthorized' })
        : jsonResponse(202, {
          auditId: 'audit-123',
          status: 'queued',
          reused: false
        });
    }
  });
  const created = await client.createAudit({
    url: 'https://example.com'
  }, 'logical-run-123');

  assert.equal(created.auditId, 'audit-123');
  assert.equal(invalidated, 1);
  assert.equal(requests.length, 2);
  assert.equal(requests[1].options.headers.authorization, 'Bearer fresh-token');
  assert.equal(requests[1].options.headers['idempotency-key'], 'logical-run-123');
  assert.doesNotMatch(requests[1].options.body, /logical-run-123|fresh-token/);
});

test('does not expose an authorization token in API errors', async () => {
  const client = createAuditClient({
    apiUrl: 'https://api.example.com',
    tokenProvider: {
      getAccessToken: async () => 'private-token',
      invalidate: () => {}
    },
    fetchFunction: async () => jsonResponse(503, {
      error: 'internal token private-token'
    })
  });

  await assert.rejects(
    client.getAudit('audit-123'),
    (error) => {
      assert.doesNotMatch(error.message, /private-token/);

      return true;
    }
  );
});

test('preserves safe API guidance for recoverable audit failures', async () => {
  const cases = [
    [400, { error: 'url must be a valid HTTPS URL.' }, null],
    [403, { error: 'The application is not verified.' }, null],
    [409, { error: 'Retry the request with the same idempotency key.' }, null],
    [429, { error: 'Your audit allowance has been used.' }, '60']
  ];

  for (const [status, body, retryAfter] of cases) {
    const client = createAuditClient({
      apiUrl: 'https://api.example.com',
      tokenProvider: {
        getAccessToken: async () => 'test-token',
        invalidate: () => {}
      },
      fetchFunction: async () => jsonResponse(status, body, retryAfter ? {
        'retry-after': retryAfter
      } : {})
    });

    await assert.rejects(
      client.getAudit('audit-123'),
      (error) => {
        assert.equal(error.message, body.error);
        assert.equal(error.retryAfter, retryAfter);

        return true;
      }
    );
  }
});

test('does not retry a 401 more than once', async () => {
  let calls = 0;
  let invalidated = 0;
  const client = createAuditClient({
    apiUrl: 'https://api.example.com',
    tokenProvider: {
      getAccessToken: async () => `token-${calls}`,
      invalidate: () => {
        invalidated += 1;
      }
    },
    fetchFunction: async () => {
      calls += 1;

      return jsonResponse(401, {
        error: 'Unauthorized'
      });
    }
  });

  await assert.rejects(client.getAudit('audit-123'), /credentials were rejected/);
  assert.equal(calls, 2);
  assert.equal(invalidated, 1);
});

test('reports an unknown outcome when an API request cannot be reached', async () => {
  const client = createAuditClient({
    apiUrl: 'https://api.example.com',
    tokenProvider: {
      getAccessToken: async () => 'test-token',
      invalidate: () => {}
    },
    fetchFunction: async () => {
      throw new Error('network failure');
    }
  });

  await assert.rejects(client.createAudit({
    url: 'https://example.com'
  }, 'run-123'), /outcome may be unknown/);
});
