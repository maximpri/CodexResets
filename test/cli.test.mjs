import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { SafeError } from '../src/auth.mjs';
import { parseArguments, parseInterval, watchReports } from '../src/cli.mjs';

const cli = new URL('../src/cli.mjs', import.meta.url);
const fixture = new URL('fixtures/credits.json', import.meta.url);

test('uses CodexResets as the public CLI name', () => {
  const output = execFileSync(process.execPath, [cli.pathname, '--help'], { encoding: 'utf8' });
  assert.match(output, /^CodexResets$/m);
  assert.match(output, /^  codexresets \[options\]$/m);
  assert.match(output, /--details/);
  assert.match(output, /--no-redeem-prompt/);
});

test('renders an offline fixture without credentials', () => {
  const output = execFileSync(process.execPath, [
    cli.pathname,
    '--input', fixture.pathname,
    '--now', '2026-07-13T23:25:36Z',
    '--timezone', 'UTC',
    '--color', 'never',
    '--width', '80',
  ], { encoding: 'utf8' });

  assert.match(output, /CODEXRESETS/);
  assert.match(output, /PLAN TO RECHECK/);
  assert.match(output, /redeem only if usage is/);
  assert.match(output, /still near its limit/);
  assert.match(output, /Forecast/);
  assert.match(output, /Weekly capacity may run out/);
  assert.match(output, /20% used/);
  assert.match(output, /Banked/);
  assert.match(output, /3 available/);
  assert.match(output, /codexresets --details/);
  assert.doesNotMatch(output, /KEY MILESTONES/);
  assert.doesNotMatch(output, /example0000000/);
});

test('renders the full diagnostic table only when details are requested', () => {
  const output = execFileSync(process.execPath, [
    cli.pathname,
    '--input', fixture.pathname,
    '--now', '2026-07-13T23:25:36Z',
    '--timezone', 'UTC',
    '--color', 'never',
    '--width', '80',
    '--details',
  ], { encoding: 'utf8' });

  assert.match(output, /DECISION/);
  assert.match(output, /USE A BANKED RESET IN/);
  assert.match(output, /KEY MILESTONES/);
  assert.match(output, /LIMIT STATUS/);
  assert.match(output, /BANKED RESETS/);
  assert.match(output, /3 AVAILABLE/);
});

test('runs through an npm-style executable symlink', {
  skip: process.platform === 'win32' ? 'symlink behavior differs on Windows' : false,
}, () => {
  const directory = mkdtempSync(join(tmpdir(), 'codexresets-bin-'));
  const executable = join(directory, 'codexresets');
  symlinkSync(cli.pathname, executable);

  const output = execFileSync(executable, ['--version'], { encoding: 'utf8' });
  assert.equal(output, '1.0.0\n');
});

test('uses a borderless responsive layout in a narrow terminal', () => {
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

  assert.match(output, /^CODEXRESETS$/m);
  assert.doesNotMatch(output, /[╭╮╰╯]/);
  for (const line of output.trimEnd().split('\n')) {
    assert.ok([...line].length <= 40, line);
  }
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

test('validates safe watch intervals and incompatible options', () => {
  assert.equal(parseInterval('1m'), 60_000);
  assert.equal(parseInterval('24h'), 86_400_000);
  assert.throws(() => parseInterval('59s'), /at least 1 minute/);
  assert.throws(() => parseInterval('25h'), /cannot exceed 24 hours/);
  assert.throws(
    () => parseArguments(['--watch', '1m', '--format', 'json']),
    /table output only/,
  );
  assert.throws(
    () => parseArguments(['--record', '--input', fixture.pathname]),
    /cannot be used with offline/,
  );
  assert.throws(
    () => parseArguments(['--record', '--now', '2026-07-14T00:00:00Z']),
    /cannot be combined with --now/,
  );
  assert.throws(
    () => parseArguments(['--auth-file', '/tmp/same', '--history-file', '/tmp/same']),
    /must be different/,
  );
  assert.equal(parseArguments(['--no-redeem-prompt']).redeemPrompt, false);
  assert.equal(parseArguments(['--details']).details, true);
  assert.equal(parseArguments(['--show-ids']).details, true);
  assert.equal(parseArguments(['--width', '40']).width, 40);
  assert.throws(() => parseArguments(['--width', '39']), /between 40 and 120/);
  assert.equal(parseArguments(['--auth-file', '/tmp/custom-auth.json']).authFileExplicit, true);
});

test('offline fixtures ignore ambient recorded history', () => {
  const codexHome = mkdtempSync(join(tmpdir(), 'codexresets-cli-'));
  const legacyFile = join(codexHome, 'reset-credits-history.json');
  const historyFile = join(codexHome, 'codexresets-history.json');
  writeFileSync(legacyFile, JSON.stringify({
    schema_version: 1,
    snapshots: [{
      checked_at: '2026-07-13T22:25:36.000Z',
      weekly: {
        used_percent: 1,
        resets_at: '2026-07-20T00:00:00.000Z',
      },
    }],
  }));
  const output = execFileSync(process.execPath, [
    cli.pathname,
    '--input', fixture.pathname,
    '--now', '2026-07-13T23:25:36Z',
    '--timezone', 'UTC',
    '--color', 'never',
    '--details',
  ], {
    encoding: 'utf8',
    env: {
      ...process.env,
      CODEX_HOME: codexHome,
      CODEX_AUTH_FILE: '',
      CODEX_HISTORY_FILE: '',
    },
  });
  assert.match(output, /20\.32 points\/day .*day\/night weighted/);
  assert.doesNotMatch(output, /recorded delta/);
  assert.equal(existsSync(legacyFile), true);
  assert.equal(existsSync(historyFile), false);
});

test('shows a sanitized history summary without authentication', () => {
  const directory = mkdtempSync(join(tmpdir(), 'codexresets-cli-'));
  const historyFile = join(directory, 'history.json');
  writeFileSync(historyFile, JSON.stringify({
    schema_version: 1,
    snapshots: [{
      checked_at: new Date().toISOString(),
      weekly: {
        used_percent: 25,
        resets_at: new Date(Date.now() + 86_400_000).toISOString(),
      },
    }],
  }));
  const output = execFileSync(process.execPath, [
    cli.pathname,
    '--history',
    '--history-file', historyFile,
  ], { encoding: 'utf8' });
  assert.match(output, /Sanitized usage history/);
  assert.match(output, /Snapshots: 1/);
  assert.match(output, /Weekly samples: 1/);
  assert.doesNotMatch(output, new RegExp(directory));
});

test('migrates the validated legacy default history without authentication', () => {
  const codexHome = mkdtempSync(join(tmpdir(), 'codexresets-home-'));
  const legacyFile = join(codexHome, 'reset-credits-history.json');
  const historyFile = join(codexHome, 'codexresets-history.json');
  writeFileSync(legacyFile, JSON.stringify({
    schema_version: 1,
    snapshots: [{
      checked_at: new Date(Date.now() - 1_000).toISOString(),
      weekly: {
        used_percent: 25,
        resets_at: new Date(Date.now() + 86_400_000).toISOString(),
      },
    }],
  }));

  const output = execFileSync(process.execPath, [cli.pathname, '--history'], {
    encoding: 'utf8',
    env: {
      ...process.env,
      CODEX_HOME: codexHome,
      CODEX_AUTH_FILE: '',
      CODEX_HISTORY_FILE: '',
    },
  });
  assert.match(output, /Snapshots: 1/);
  assert.equal(existsSync(legacyFile), false);
  assert.equal(existsSync(historyFile), true);
});

test('forget history removes coexisting legacy and CodexResets files', () => {
  const codexHome = mkdtempSync(join(tmpdir(), 'codexresets-home-'));
  const legacyFile = join(codexHome, 'reset-credits-history.json');
  const historyFile = join(codexHome, 'codexresets-history.json');
  const history = JSON.stringify({ schema_version: 1, snapshots: [] });
  writeFileSync(legacyFile, history);
  writeFileSync(historyFile, history);
  const environment = {
    ...process.env,
    CODEX_HOME: codexHome,
    CODEX_AUTH_FILE: '',
    CODEX_HISTORY_FILE: '',
  };

  const output = execFileSync(process.execPath, [cli.pathname, '--forget-history'], {
    encoding: 'utf8',
    env: environment,
  });
  assert.match(output, /history deleted/);
  assert.equal(existsSync(legacyFile), false);
  assert.equal(existsSync(historyFile), false);

  const summary = execFileSync(process.execPath, [cli.pathname, '--history'], {
    encoding: 'utf8',
    env: environment,
  });
  assert.match(summary, /Snapshots: 0/);
  assert.equal(existsSync(legacyFile), false);
  assert.equal(existsSync(historyFile), false);
});

function watchReport(action, recommendedAt = null) {
  return {
    checkedAt: new Date('2026-07-14T00:00:00Z'),
    recommendation: {
      action,
      constrainingWindow: 'weekly',
      recommendedAt: recommendedAt ? new Date(recommendedAt) : null,
    },
    nextSavedReset: null,
  };
}

test('watch mode emits only material changes and notifies on stderr', async () => {
  const reports = [
    watchReport('WAIT_FOR_WEEKLY_RESET'),
    watchReport('WAIT_FOR_WEEKLY_RESET'),
    watchReport('USE_NEAR_LIMIT', '2026-07-14T05:00:00Z'),
  ];
  let stdout = '';
  let stderr = '';
  const waits = [];
  await watchReports({ watchMs: 60_000, notify: true }, {
    buildReport: async () => reports.shift(),
    renderReport: (report) => `${report.recommendation.action}\n`,
    wait: async (milliseconds) => waits.push(milliseconds),
    stdout: { isTTY: true, write: (value) => { stdout += value; } },
    stderr: { write: (value) => { stderr += value; } },
    maximumIterations: 3,
  });
  assert.equal(stdout, 'WAIT_FOR_WEEKLY_RESET\n\nUSE_NEAR_LIMIT\n');
  assert.equal(stderr, '\u0007');
  assert.deepEqual(waits, [60_000, 60_000]);
});

test('watch mode explains its quiet behavior in an interactive terminal', async () => {
  let stderr = '';
  await watchReports({ watchMs: 15 * 60_000, notify: false }, {
    buildReport: async () => watchReport('WAIT_FOR_WEEKLY_RESET'),
    renderReport: () => 'BASELINE\n',
    stdout: { isTTY: true, write: () => {} },
    stderr: { isTTY: true, write: (value) => { stderr += value; } },
    maximumIterations: 1,
  });
  assert.match(stderr, /Watching every 15m/);
  assert.match(stderr, /only material changes will print/);
  assert.match(stderr, /Press Ctrl\+C to stop/);
});

test('watch mode refreshes and renders account limits after a consumed reset', async () => {
  const reports = [
    watchReport('USE_NOW', '2026-07-14T00:00:00Z'),
    watchReport('WAIT_FOR_WEEKLY_RESET'),
  ];
  let stdout = '';
  let offers = 0;
  await watchReports({ watchMs: 60_000, notify: false }, {
    buildReport: async () => reports.shift(),
    renderReport: (report) => `${report.recommendation.action}\n`,
    offerRedemption: async () => {
      offers += 1;
      return { status: 'consumed', outcome: 'reset' };
    },
    wait: async () => {},
    stdout: { isTTY: true, write: (value) => { stdout += value; } },
    stderr: { isTTY: true, write: () => {} },
    maximumIterations: 1,
  });
  assert.equal(offers, 1);
  assert.equal(stdout, 'USE_NOW\n\nWAIT_FOR_WEEKLY_RESET\n');
});

test('watch mode backs off retryable failures after its initial baseline', async () => {
  const outcomes = [
    watchReport('WAIT_FOR_WEEKLY_RESET'),
    new SafeError('Temporary service failure.', { retryable: true }),
    watchReport('USE_NEAR_LIMIT', '2026-07-14T05:00:00Z'),
  ];
  const waits = [];
  let stderr = '';
  await watchReports({ watchMs: 60_000, notify: false }, {
    buildReport: async () => {
      const outcome = outcomes.shift();
      if (outcome instanceof Error) throw outcome;
      return outcome;
    },
    renderReport: () => '',
    wait: async (milliseconds) => waits.push(milliseconds),
    stdout: { isTTY: false, write: () => {} },
    stderr: { write: (value) => { stderr += value; } },
    maximumIterations: 3,
  });
  assert.deepEqual(waits, [60_000, 120_000]);
  assert.match(stderr, /Watch warning: Temporary service failure/);
});

test('watch mode preserves successful intervals longer than the retry cap', async () => {
  const waits = [];
  await watchReports({ watchMs: 60 * 60_000, notify: false }, {
    buildReport: async () => watchReport('WAIT_FOR_WEEKLY_RESET'),
    renderReport: () => '',
    wait: async (milliseconds) => waits.push(milliseconds),
    stdout: { isTTY: false, write: () => {} },
    stderr: { write: () => {} },
    maximumIterations: 2,
  });
  assert.deepEqual(waits, [60 * 60_000]);
});

test('watch mode stops on permanent failures after its initial baseline', async () => {
  const outcomes = [
    watchReport('WAIT_FOR_WEEKLY_RESET'),
    new SafeError('Authentication is required.'),
  ];
  const waits = [];
  await assert.rejects(watchReports({ watchMs: 60_000, notify: false }, {
    buildReport: async () => {
      const outcome = outcomes.shift();
      if (outcome instanceof Error) throw outcome;
      return outcome;
    },
    renderReport: () => '',
    wait: async (milliseconds) => waits.push(milliseconds),
    stdout: { isTTY: false, write: () => {} },
    stderr: { write: () => {} },
    maximumIterations: 2,
  }), /Authentication is required/);
  assert.deepEqual(waits, [60_000]);
});

test('CLI errors neutralize terminal control characters', () => {
  assert.throws(() => execFileSync(process.execPath, [
    cli.pathname,
    '--unknown\u001b[31m',
  ], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }), (error) => {
    assert.doesNotMatch(error.stderr, /\u001b/);
    assert.match(error.stderr, /Unknown option/);
    return true;
  });
});

test('CLI errors suggest the nearest known long option', () => {
  assert.throws(() => execFileSync(process.execPath, [
    cli.pathname,
    '--watc', '5m',
  ], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }), (error) => {
    assert.match(error.stderr, /Did you mean --watch\?/);
    return true;
  });
});
