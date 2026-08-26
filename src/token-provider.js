const TOKEN_REFRESH_MARGIN_MS = 30_000;
const AUDIT_SCOPE = 'https://api.pwa.today/checks.run';

const requiredEnvironmentValue = (environment, name) => {
  const value = environment[name];

  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`${name} must be configured in the MCP server environment.`);
  }

  return value;
};

export const getConfiguration = (environment = process.env) => {
  const apiUrl = environment.PWA_API_URL ?? 'https://api.pwa.today';
  let parsedApiUrl;

  try {
    parsedApiUrl = new URL(apiUrl);
  }
  catch {
    throw new Error('PWA_API_URL must be a valid URL.');
  }

  if (!['http:', 'https:'].includes(parsedApiUrl.protocol)) {
    throw new Error('PWA_API_URL must use HTTP or HTTPS.');
  }

  return {
    apiUrl: parsedApiUrl.href.replace(/\/$/, ''),
    clientId: requiredEnvironmentValue(environment, 'PWA_CLIENT_ID'),
    clientSecret: requiredEnvironmentValue(environment, 'PWA_CLIENT_SECRET')
  };
};

export const createTokenProvider = ({
  apiUrl,
  clientId,
  clientSecret,
  fetchFunction = fetch,
  now = () => Date.now()
}) => {
  let cachedToken = null;

  const refresh = async () => {
    let response;

    try {
      response = await fetchFunction(`${apiUrl}/token`, {
        method: 'POST',
        headers: {
          accept: 'application/json',
          authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`,
          'content-type': 'application/x-www-form-urlencoded'
        },
        body: new URLSearchParams({
          grant_type: 'client_credentials',
          scope: AUDIT_SCOPE
        }),
        signal: AbortSignal.timeout(8_000)
      });
    }
    catch {
      throw new Error('The PWA Today authorization service could not be reached.');
    }

    let body;

    try {
      body = await response.json();
    }
    catch {
      throw new Error('The PWA Today authorization service returned an invalid response.');
    }

    if (!response.ok || typeof body.access_token !== 'string') {
      throw new Error('PWA Today credentials were rejected. Update the configured credentials and reconnect.');
    }

    const expiresIn = Number(body.expires_in);

    if (!Number.isFinite(expiresIn) || expiresIn <= 0) {
      throw new Error('The PWA Today authorization service returned an invalid token lifetime.');
    }

    cachedToken = {
      accessToken: body.access_token,
      expiresAt: now() + expiresIn * 1_000
    };

    return cachedToken.accessToken;
  };

  return {
    getAccessToken: async () => {
      if (cachedToken && now() < cachedToken.expiresAt - TOKEN_REFRESH_MARGIN_MS) {
        return cachedToken.accessToken;
      }

      return await refresh();
    },
    invalidate: () => {
      cachedToken = null;
    }
  };
};
