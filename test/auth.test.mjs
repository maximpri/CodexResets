import assert from 'node:assert/strict';
import { chmod, mkdtemp, readFile, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
  clientIdFromAuth,
  fetchAccountData,
  fetchCredits,
  SafeError,
} from '../src/auth.mjs';
import { scanText } from '../scripts/scan-secrets.mjs';

function jwt(payload) {
  return `header.${Buffer.from(JSON.stringify(payload)).toString('base64url')}.signature`;
}

test('extracts a synthetic OAuth audience without exposing the token', () => {
  const auth = { tokens: { id_token: jwt({ aud: ['synthetic-client'] }) } };
  assert.equal(clientIdFromAuth(auth), 'synthetic-client');
});

test('secret scanner reports metadata without retaining secret values', () => {
  const githubToken = ['ghp_', 'A'.repeat(36)].join('');
  const bearerToken = `Bearer ${'b'.repeat(24)}`;
  const encoded = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
  const jwtToken = [
    encoded({ alg: 'HS256', typ: 'JWT' }),
    encoded({ sub: 'account', exp: 2_000_000_000 }),
    'c'.repeat(32),
  ].join('.');
  const privateKeyHeader = ['-----BEGIN ', 'PRIVATE KEY-----'].join('');

  const findings = scanText([
    githubToken,
    bearerToken,
    jwtToken,
    privateKeyHeader,
  ].join('\n'));

  assert.deepEqual(findings, [
    { line: 1, type: 'github-token' },
    { line: 2, type: 'bearer-token' },
    { line: 3, type: 'jwt' },
    { line: 4, type: 'private-key' },
  ]);
  assert.ok(!JSON.stringify(findings).includes(githubToken));
  assert.ok(!JSON.stringify(findings).includes(bearerToken));
  assert.ok(!JSON.stringify(findings).includes(jwtToken));
});

test('secret scanner permits values that are visibly synthetic', () => {
  const githubToken = ['ghp_', 'syntheticexampletokenvalue1234567890'].join('');
  const privateKeyHeader = ['-----BEGIN ', 'PRIVATE KEY-----'].join('');
  const findings = scanText([
    githubToken,
    'authorization: Bearer synthetic-test-token',
    `const syntheticPrivateKey = "${privateKeyHeader}"; // secret-scan: allow-synthetic`,
  ].join('\n'));
  assert.deepEqual(findings, []);
});

test('secret scanner does not trust a generic synthetic-looking comment', () => {
  const token = ['ghp_', 'A'.repeat(36)].join('');
  assert.deepEqual(scanText(`${token} // example integration`), [
    { line: 1, type: 'github-token' },
  ]);
});

test('API failures do not include raw response bodies', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'codexresets-'));
  const authFile = join(directory, 'auth.json');
  await writeFile(authFile, JSON.stringify({ tokens: { access_token: 'synthetic-access-token' } }), {
    mode: 0o600,
  });

  const mockFetch = async () => new Response(JSON.stringify({
    error: { code: 'service_error' },
    secret: 'must-not-appear',
  }), { status: 500 });

  await assert.rejects(
    fetchCredits(authFile, mockFetch),
    (error) => error instanceof SafeError
      && error.retryable
      && /HTTP 500 \(service_error\)/.test(error.message)
      && !error.message.includes('must-not-appear'),
  );
});

test('non-JSON transient service failures remain retryable', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'codexresets-'));
  const authFile = join(directory, 'auth.json');
  await writeFile(authFile, JSON.stringify({ tokens: { access_token: 'synthetic-access-token' } }), {
    mode: 0o600,
  });

  await assert.rejects(
    fetchCredits(authFile, async () => new Response('<html>temporary</html>', { status: 503 })),
    (error) => error instanceof SafeError
      && error.retryable
      && error.message === 'OpenAI returned invalid JSON (HTTP 503).',
  );
});

test('uses the existing access token without an unnecessary refresh', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'codexresets-'));
  const authFile = join(directory, 'auth.json');
  await writeFile(authFile, JSON.stringify({ tokens: {
    access_token: 'synthetic-current-token',
    refresh_token: 'synthetic-refresh-token',
    id_token: jwt({ aud: 'synthetic-client' }),
  } }), { mode: 0o600 });

  const requests = [];
  const mockFetch = async (url, options) => {
    requests.push({ url, options });
    return new Response(JSON.stringify({ credits: [] }), { status: 200 });
  };

  const result = await fetchCredits(authFile, mockFetch);
  assert.deepEqual(result, { credits: [] });
  assert.equal(requests.length, 1);
  assert.match(requests[0].url, /rate-limit-reset-credits$/);
  assert.equal(requests[0].options.headers.authorization, 'Bearer synthetic-current-token');
});

test('fetches credits and weekly usage with the same authenticated session', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'codexresets-'));
  const authFile = join(directory, 'auth.json');
  await writeFile(authFile, JSON.stringify({ tokens: {
    access_token: 'synthetic-current-token',
  } }), { mode: 0o600 });

  const requests = [];
  const mockFetch = async (url, options) => {
    requests.push({ url, options });
    if (url.endsWith('/wham/usage')) {
      return new Response(JSON.stringify({ rate_limit: { allowed: true } }), { status: 200 });
    }
    return new Response(JSON.stringify({ credits: [] }), { status: 200 });
  };

  const result = await fetchAccountData(authFile, mockFetch);
  assert.deepEqual(result, {
    credits: [],
    usage: { rate_limit: { allowed: true } },
  });
  assert.equal(requests.length, 2);
  assert.ok(requests.every(({ options }) => (
    options.headers.authorization === 'Bearer synthetic-current-token'
  )));
});

test('combined usage refreshes once when both account requests reject the session', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'codexresets-'));
  const authFile = join(directory, 'auth.json');
  await writeFile(authFile, JSON.stringify({ tokens: {
    access_token: 'synthetic-expired-token',
    refresh_token: 'synthetic-old-refresh',
    id_token: jwt({ aud: 'synthetic-client' }),
  } }), { mode: 0o600 });

  const requests = [];
  const mockFetch = async (url, options) => {
    requests.push({ url, options });
    if (url.includes('/oauth/token')) {
      return new Response(JSON.stringify({ access_token: 'synthetic-new-token' }), { status: 200 });
    }
    if (options.headers.authorization === 'Bearer synthetic-expired-token') {
      return new Response('{}', { status: 401 });
    }
    if (url.endsWith('/wham/usage')) {
      return new Response(JSON.stringify({ rate_limit: { allowed: true } }), { status: 200 });
    }
    return new Response(JSON.stringify({ credits: [] }), { status: 200 });
  };

  const result = await fetchAccountData(authFile, mockFetch);
  assert.equal(result.usage.rate_limit.allowed, true);
  assert.equal(requests.filter(({ url }) => url.includes('/oauth/token')).length, 1);
  assert.equal(requests.length, 5);
  const saved = JSON.parse(await readFile(authFile, 'utf8'));
  assert.equal(saved.tokens.access_token, 'synthetic-new-token');
});

test('refreshes after a 401 and replaces permissive credentials with mode 0600', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'codexresets-'));
  const authFile = join(directory, 'auth.json');
  await writeFile(authFile, JSON.stringify({ tokens: {
    access_token: 'synthetic-expired-token',
    refresh_token: 'synthetic-old-refresh',
    id_token: jwt({ aud: 'synthetic-client' }),
  } }), { mode: 0o600 });
  await chmod(authFile, 0o644);
  assert.equal((await stat(authFile)).mode & 0o777, 0o644);

  let request = 0;
  const mockFetch = async () => {
    request += 1;
    if (request === 1) return new Response('{}', { status: 401 });
    if (request === 2) return new Response(JSON.stringify({
      access_token: 'synthetic-new-token',
      refresh_token: 'synthetic-new-refresh',
    }), { status: 200 });
    return new Response(JSON.stringify({ credits: [] }), { status: 200 });
  };

  assert.deepEqual(await fetchCredits(authFile, mockFetch), { credits: [] });
  assert.equal(request, 3);
  const saved = JSON.parse(await readFile(authFile, 'utf8'));
  assert.equal(saved.tokens.access_token, 'synthetic-new-token');
  assert.equal(saved.tokens.refresh_token, 'synthetic-new-refresh');
  assert.equal((await stat(authFile)).mode & 0o777, 0o600);
});
