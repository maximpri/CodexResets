import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import test from 'node:test';

const cli = new URL('../src/cli.mjs', import.meta.url);
const fixture = new URL('fixtures/credits.json', import.meta.url);

test('renders an offline fixture without credentials', () => {
  const output = execFileSync(process.execPath, [
    cli.pathname,
    '--input', fixture.pathname,
    '--now', '2026-07-13T23:25:36Z',
    '--timezone', 'UTC',
    '--color', 'never',
    '--width', '80',
  ], { encoding: 'utf8' });

  assert.match(output, /CODEX  \/  RESET CREDITS/);
  assert.match(output, /WEEKLY USAGE/);
  assert.match(output, /20% used/);
  assert.match(output, /SMART RESET PLAN/);
  assert.match(output, /3 available credits/);
  assert.doesNotMatch(output, /example0000000/);
});

test('uses the minimum layout width in a narrow terminal', () => {
  const output = execFileSync(process.execPath, [
    cli.pathname,
    '--input', fixture.pathname,
    '--now', '2026-07-13T23:25:36Z',
    '--timezone', 'UTC',
    '--color', 'never',
  ], {
    encoding: 'utf8',
    env: { ...process.env, COLUMNS: '40' },
  });

  assert.equal([...output.split('\n')[0]].length, 68);
});

test('fails clearly when the service shape is not recognized', () => {
  assert.throws(() => execFileSync(process.execPath, [
    cli.pathname,
    '--input', '-',
    '--timezone', 'UTC',
  ], {
    encoding: 'utf8',
    input: '{}',
    stdio: ['pipe', 'pipe', 'pipe'],
  }), (error) => {
    assert.match(error.stderr, /does not contain a credits list/);
    return true;
  });
});
