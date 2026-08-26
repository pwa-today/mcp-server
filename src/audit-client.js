export class AuditApiError extends Error {
  constructor(message, {
    retryAfter = null,
    status = null
  } = {}) {
    super(message);
    this.name = 'AuditApiError';
    this.retryAfter = retryAfter;
    this.status = status;
  }
}

const getErrorMessage = (response, body) => {
  if (response.status >= 500) {
    return 'PWA Today is temporarily unavailable. Try again later.';
  }

  if (response.status === 401) {
    return 'PWA Today credentials were rejected. Update the configured credentials and reconnect.';
  }

  return typeof body?.error === 'string'
    ? body.error
    : `PWA Today returned HTTP ${response.status}.`;
};

export const createAuditClient = ({
  apiUrl,
  tokenProvider,
  fetchFunction = fetch,
  requestTimeoutMs = 30_000
}) => {
  const request = async ({
    body,
    idempotencyKey,
    method = 'GET',
    path
  }) => {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const accessToken = await tokenProvider.getAccessToken();
      let response;

      try {
        response = await fetchFunction(`${apiUrl}${path}`, {
          method,
          headers: {
            accept: 'application/json',
            authorization: `Bearer ${accessToken}`,
            ...(body ? {
              'content-type': 'application/json'
            } : {}),
            ...(idempotencyKey ? {
              'idempotency-key': idempotencyKey
            } : {})
          },
          body: body ? JSON.stringify(body) : undefined,
          signal: AbortSignal.timeout(requestTimeoutMs)
        });
      }
      catch {
        throw new AuditApiError(
          'The PWA Today request timed out or could not be reached. The outcome may be unknown; check the audit status or retry creation with the same idempotency key.'
        );
      }

      let responseBody;

      try {
        responseBody = await response.json();
      }
      catch {
        throw new AuditApiError(
          `PWA Today returned HTTP ${response.status} without a JSON response.`,
          { status: response.status }
        );
      }

      if (response.status === 401 && attempt === 0) {
        tokenProvider.invalidate();
        continue;
      }

      if (!response.ok) {
        throw new AuditApiError(getErrorMessage(response, responseBody), {
          retryAfter: response.headers.get('retry-after'),
          status: response.status
        });
      }

      return responseBody;
    }

    throw new AuditApiError('PWA Today credentials were rejected. Update the configured credentials and reconnect.', {
      status: 401
    });
  };

  return {
    createAudit: async (requestBody, idempotencyKey) => {
      return await request({
        body: requestBody,
        idempotencyKey,
        method: 'POST',
        path: '/v1/audits'
      });
    },
    getAudit: async (auditId) => {
      return await request({
        path: `/v1/audits/${encodeURIComponent(auditId)}`
      });
    },
    getAuditResults: async (auditId) => {
      return await request({
        path: `/v1/audits/${encodeURIComponent(auditId)}/results`
      });
    }
  };
};
