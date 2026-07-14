import { chmod, readFile, realpath, rename, stat, unlink, writeFile } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';

export const CREDITS_URL = 'https://chatgpt.com/backend-api/wham/rate-limit-reset-credits';
export const USAGE_URL = 'https://chatgpt.com/backend-api/wham/usage';
const TOKEN_URL = 'https://auth.openai.com/api/accounts/oauth/token';

export class SafeError extends Error {
  constructor(message, { cause } = {}) {
    super(message, { cause });
    this.name = 'SafeError';
  }
}

function decodeJwtPayload(token) {
  const segment = String(token || '').split('.')[1];
  if (!segment) return null;

  try {
    return JSON.parse(Buffer.from(segment, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
}

export function clientIdFromAuth(auth) {
  const payload = decodeJwtPayload(auth?.tokens?.id_token);
  const audience = payload?.aud;
  const clientId = Array.isArray(audience) ? audience[0] : audience;
  return typeof clientId === 'string' ? clientId : '';
}

function safeErrorCode(value) {
  const code = typeof value === 'string' ? value : '';
  return /^[a-zA-Z0-9_.-]{1,80}$/.test(code) ? ` (${code})` : '';
}

async function parseResponse(response) {
  const text = await response.text();
  if (!text) return {};

  try {
    return JSON.parse(text);
  } catch {
    throw new SafeError(`OpenAI returned invalid JSON (HTTP ${response.status}).`);
  }
}

async function loadAuth(authFile) {
  try {
    return JSON.parse(await readFile(authFile, 'utf8'));
  } catch (error) {
    if (error?.code === 'ENOENT') {
      throw new SafeError('Codex credentials were not found. Run `codex login` first.');
    }
    if (error instanceof SyntaxError) {
      throw new SafeError('The Codex credential file is not valid JSON.');
    }
    throw new SafeError('Could not read the Codex credential file.', { cause: error });
  }
}

async function saveAuth(authFile, auth, expectedAuth) {
  const destination = await realpath(authFile).catch(() => authFile);
  const directory = dirname(destination);
  const temporary = join(directory, `.${basename(destination)}.${process.pid}.${randomUUID()}.tmp`);
  let mode = 0o600;

  try {
    mode = (await stat(destination)).mode & 0o777;
    await writeFile(temporary, `${JSON.stringify(auth, null, 2)}\n`, {
      encoding: 'utf8',
      mode: 0o600,
      flag: 'wx',
    });
    await chmod(temporary, mode);

    // Do not overwrite a session that Codex refreshed while this request was in flight.
    const current = JSON.parse(await readFile(destination, 'utf8'));
    if (current?.tokens?.access_token !== expectedAuth?.tokens?.access_token
      || current?.tokens?.refresh_token !== expectedAuth?.tokens?.refresh_token) {
      throw new SafeError('Codex credentials changed during refresh. Retry the command.');
    }
    await rename(temporary, destination);
  } catch (error) {
    await unlink(temporary).catch(() => {});
    if (error instanceof SafeError) throw error;
    throw new SafeError('A refreshed session was received, but the Codex credential file could not be updated safely.', {
      cause: error,
    });
  }
}

async function refreshSession(authFile, auth, fetchImpl) {
  const refreshToken = auth?.tokens?.refresh_token;
  const clientId = clientIdFromAuth(auth);
  if (!refreshToken || !clientId) {
    throw new SafeError('The Codex session cannot be refreshed. Run `codex login` and try again.');
  }

  let response;
  try {
    response = await fetchImpl(TOKEN_URL, {
      method: 'POST',
      redirect: 'error',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        client_id: clientId,
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
      }),
    });
  } catch (error) {
    throw new SafeError('Could not reach the OpenAI authentication service.', { cause: error });
  }

  const body = await parseResponse(response);
  if (!response.ok || typeof body.access_token !== 'string' || !body.access_token) {
    const suffix = safeErrorCode(body?.error?.code ?? body?.error);
    throw new SafeError(`The Codex session could not be refreshed${suffix}. Run \`codex login\` and try again.`);
  }

  const nextAuth = structuredClone(auth);
  nextAuth.tokens ??= {};
  nextAuth.tokens.access_token = body.access_token;
  if (typeof body.refresh_token === 'string' && body.refresh_token) {
    nextAuth.tokens.refresh_token = body.refresh_token;
  }
  nextAuth.last_refresh = new Date().toISOString();
  await saveAuth(authFile, nextAuth, auth);
  return { auth: nextAuth, accessToken: body.access_token };
}

async function requestResource(url, label, accessToken, fetchImpl) {
  let response;
  try {
    response = await fetchImpl(url, {
      redirect: 'error',
      headers: {
        accept: 'application/json',
        authorization: `Bearer ${accessToken}`,
      },
    });
  } catch (error) {
    throw new SafeError(`Could not reach the Codex ${label} service.`, { cause: error });
  }

  if (response.status === 401) return { unauthorized: true };

  const body = await parseResponse(response);
  if (!response.ok) {
    const suffix = safeErrorCode(body?.error?.code ?? body?.error);
    throw new SafeError(`The Codex ${label} service returned HTTP ${response.status}${suffix}.`);
  }
  return { body, unauthorized: false };
}

const requestCredits = (accessToken, fetchImpl) => requestResource(
  CREDITS_URL,
  'credits',
  accessToken,
  fetchImpl,
);

const requestUsage = (accessToken, fetchImpl) => requestResource(
  USAGE_URL,
  'usage',
  accessToken,
  fetchImpl,
);

async function fetchWithSession(authFile, fetchImpl, request) {
  if (typeof fetchImpl !== 'function') {
    throw new SafeError('This Node.js version does not provide fetch. Install Node.js 18 or newer.');
  }

  let auth = await loadAuth(authFile);
  let accessToken = auth?.tokens?.access_token;

  if (!accessToken) {
    ({ auth, accessToken } = await refreshSession(authFile, auth, fetchImpl));
  }

  let result = await request(accessToken, fetchImpl);
  if (result.unauthorized) {
    ({ auth, accessToken } = await refreshSession(authFile, auth, fetchImpl));
    result = await request(accessToken, fetchImpl);
  }

  if (result.unauthorized) {
    throw new SafeError('The refreshed Codex session was rejected. Run `codex login` and try again.');
  }
  return result.body;
}

export function fetchCredits(authFile, fetchImpl = globalThis.fetch) {
  return fetchWithSession(authFile, fetchImpl, requestCredits);
}

export function fetchUsage(authFile, fetchImpl = globalThis.fetch) {
  return fetchWithSession(authFile, fetchImpl, requestUsage);
}

export async function fetchAccountData(authFile, fetchImpl = globalThis.fetch) {
  if (typeof fetchImpl !== 'function') {
    throw new SafeError('This Node.js version does not provide fetch. Install Node.js 18 or newer.');
  }

  let auth = await loadAuth(authFile);
  let accessToken = auth?.tokens?.access_token;
  if (!accessToken) {
    ({ auth, accessToken } = await refreshSession(authFile, auth, fetchImpl));
  }

  let [credits, usage] = await Promise.all([
    requestCredits(accessToken, fetchImpl),
    requestUsage(accessToken, fetchImpl),
  ]);

  if (credits.unauthorized || usage.unauthorized) {
    ({ auth, accessToken } = await refreshSession(authFile, auth, fetchImpl));
    [credits, usage] = await Promise.all([
      requestCredits(accessToken, fetchImpl),
      requestUsage(accessToken, fetchImpl),
    ]);
  }

  if (credits.unauthorized || usage.unauthorized) {
    throw new SafeError('The refreshed Codex session was rejected. Run `codex login` and try again.');
  }

  return { ...credits.body, usage: usage.body };
}
