import assert from 'node:assert/strict';
import { mkdtemp, readFile, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { clientIdFromAuth, fetchCredits, SafeError } from '../src/auth.mjs';

function jwt(payload) {
  return `header.${Buffer.from(JSON.stringify(payload)).toString('base64url')}.signature`;
}

test('extracts a synthetic OAuth audience without exposing the token', () => {
  const auth = { tokens: { id_token: jwt({ aud: ['synthetic-client'] }) } };
  assert.equal(clientIdFromAuth(auth), 'synthetic-client');
});

test('API failures do not include raw response bodies', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'codex-reset-credits-'));
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
      && /HTTP 500 \(service_error\)/.test(error.message)
      && !error.message.includes('must-not-appear'),
  );
});

test('uses the existing access token without an unnecessary refresh', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'codex-reset-credits-'));
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

test('refreshes only after a 401 and atomically stores rotated tokens', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'codex-reset-credits-'));
  const authFile = join(directory, 'auth.json');
  await writeFile(authFile, JSON.stringify({ tokens: {
    access_token: 'synthetic-expired-token',
    refresh_token: 'synthetic-old-refresh',
    id_token: jwt({ aud: 'synthetic-client' }),
  } }), { mode: 0o600 });

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
