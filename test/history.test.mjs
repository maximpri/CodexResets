import assert from 'node:assert/strict';
import {
  mkdtemp,
  readFile,
  readdir,
  stat,
  truncate,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
  deleteHistory,
  emptyHistory,
  HistoryError,
  HISTORY_SCHEMA_VERSION,
  loadHistory,
  MAX_HISTORY_FILE_BYTES,
  MAX_HISTORY_SNAPSHOTS,
  recordHistory,
  saveHistory,
  snapshotFromReport,
  summarizeHistory,
} from '../src/history.mjs';

async function temporaryHistoryFile() {
  const directory = await mkdtemp(join(tmpdir(), 'codex-reset-history-'));
  return { directory, historyFile: join(directory, 'history.json') };
}

function reportAt(checkedAt, fiveHourPercent = 20, weeklyPercent = 30) {
  return {
    checkedAt: new Date(checkedAt),
    fiveHourUsage: {
      usedPercent: fiveHourPercent,
      resetsAt: new Date('2026-07-15T05:00:00Z'),
      id: 'must-not-be-stored',
    },
    weeklyUsage: {
      usedPercent: weeklyPercent,
      resetsAt: new Date('2026-07-20T00:00:00Z'),
      raw: { access_token: 'must-not-be-stored' },
    },
    credits: [{ id: 'private-credit-id' }],
    token: 'private-token',
  };
}

test('a missing history file loads as an empty schema-v1 history', async () => {
  const { historyFile } = await temporaryHistoryFile();
  assert.deepEqual(await loadHistory(historyFile), emptyHistory());
});

test('extracts only the allowed snapshot fields from a normalized report', () => {
  assert.deepEqual(snapshotFromReport(reportAt('2026-07-14T00:00:00Z')), {
    checked_at: '2026-07-14T00:00:00.000Z',
    five_hour: {
      used_percent: 20,
      resets_at: '2026-07-15T05:00:00.000Z',
    },
    weekly: {
      used_percent: 30,
      resets_at: '2026-07-20T00:00:00.000Z',
    },
  });
});

test('records history atomically with private permissions and no report metadata', async () => {
  const { directory, historyFile } = await temporaryHistoryFile();
  await recordHistory(historyFile, reportAt('2026-07-14T00:00:00Z'));

  const text = await readFile(historyFile, 'utf8');
  const saved = JSON.parse(text);
  assert.equal(saved.schema_version, HISTORY_SCHEMA_VERSION);
  assert.equal(saved.snapshots.length, 1);
  assert.doesNotMatch(text, /private|token|credit|raw|id/i);
  assert.equal((await stat(historyFile)).mode & 0o777, 0o600);
  assert.deepEqual(await readdir(directory), ['history.json']);
});

test('deduplicates timestamps, sorts snapshots, and keeps the newest value', async () => {
  const { historyFile } = await temporaryHistoryFile();
  const options = { now: new Date('2026-07-14T03:00:00Z') };
  await recordHistory(historyFile, reportAt('2026-07-14T02:00:00Z', 30), options);
  await recordHistory(historyFile, reportAt('2026-07-14T01:00:00Z', 10), options);
  const history = await recordHistory(
    historyFile,
    reportAt('2026-07-14T02:00:00Z', 35),
    options,
  );

  assert.deepEqual(history.snapshots.map(({ checked_at }) => checked_at), [
    '2026-07-14T01:00:00.000Z',
    '2026-07-14T02:00:00.000Z',
  ]);
  assert.equal(history.snapshots[1].five_hour.used_percent, 35);
});

test('coalesces recordings within a 15-minute bucket unless the reset epoch changes', async () => {
  const { historyFile } = await temporaryHistoryFile();
  await recordHistory(historyFile, reportAt('2026-07-14T00:01:00Z', 10), {
    now: new Date('2026-07-14T00:01:00Z'),
  });
  let history = await recordHistory(historyFile, reportAt('2026-07-14T00:14:00Z', 20), {
    now: new Date('2026-07-14T00:14:00Z'),
  });
  assert.equal(history.snapshots.length, 1);
  assert.equal(history.snapshots[0].five_hour.used_percent, 20);

  const changedReset = reportAt('2026-07-14T00:14:30Z', 2);
  changedReset.fiveHourUsage.resetsAt = new Date('2026-07-15T10:00:00Z');
  history = await recordHistory(historyFile, changedReset, {
    now: new Date('2026-07-14T00:14:30Z'),
  });
  assert.equal(history.snapshots.length, 2);
});

test('prunes snapshots older than 90 days and caps history at 2000 entries', async () => {
  const { historyFile } = await temporaryHistoryFile();
  const now = new Date('2026-07-14T00:00:00Z');
  const recentStart = now.getTime() - (MAX_HISTORY_SNAPSHOTS + 4) * 60 * 60 * 1_000;
  const snapshots = Array.from({ length: MAX_HISTORY_SNAPSHOTS + 5 }, (_, index) => ({
    checked_at: new Date(recentStart + index * 60 * 60 * 1_000).toISOString(),
    weekly: {
      used_percent: index % 101,
      resets_at: '2026-07-20T00:00:00.000Z',
    },
  }));
  snapshots.unshift({
    checked_at: '2026-04-01T00:00:00.000Z',
    weekly: { used_percent: 1, resets_at: '2026-04-02T00:00:00.000Z' },
  });

  const saved = await saveHistory(historyFile, {
    schema_version: HISTORY_SCHEMA_VERSION,
    snapshots,
  }, { now });
  assert.equal(saved.snapshots.length, MAX_HISTORY_SNAPSHOTS);
  assert.equal(saved.snapshots.at(-1).checked_at, now.toISOString());
  assert.ok(saved.snapshots.every(({ checked_at }) => checked_at >= '2026-04-15T00:00:00.000Z'));
});

test('save reconstructs the schema instead of serializing extra sensitive fields', async () => {
  const { historyFile } = await temporaryHistoryFile();
  await saveHistory(historyFile, {
    schema_version: HISTORY_SCHEMA_VERSION,
    access_token: 'root-secret',
    snapshots: [{
      checked_at: '2026-07-14T00:00:00Z',
      account_id: 'private-account',
      five_hour: {
        used_percent: 20,
        resets_at: '2026-07-14T05:00:00Z',
        session_id: 'private-session',
      },
    }],
  }, { now: new Date('2026-07-14T00:00:00Z') });

  const text = await readFile(historyFile, 'utf8');
  assert.doesNotMatch(text, /secret|account|session|token|private/i);
  assert.deepEqual(JSON.parse(text).snapshots[0], {
    checked_at: '2026-07-14T00:00:00.000Z',
    five_hour: {
      used_percent: 20,
      resets_at: '2026-07-14T05:00:00.000Z',
    },
  });
});

test('malformed or expanded files fail with a generic safe error', async () => {
  const { historyFile } = await temporaryHistoryFile();
  await writeFile(historyFile, '{"access_token":"highly-private"', 'utf8');

  await assert.rejects(loadHistory(historyFile), (error) => {
    assert.ok(error instanceof HistoryError);
    assert.equal(error.code, 'HISTORY_INVALID');
    assert.equal(error.message, 'Local usage history is not valid.');
    assert.doesNotMatch(error.message, /private|token|history\.json/i);
    assert.equal(error.cause, undefined);
    return true;
  });

  await writeFile(historyFile, JSON.stringify({
    schema_version: 1,
    snapshots: [],
    session_id: 'highly-private',
  }), 'utf8');
  await assert.rejects(loadHistory(historyFile), {
    code: 'HISTORY_INVALID',
    message: 'Local usage history is not valid.',
  });
});

test('rejects oversized files and snapshot counts before using their contents', async () => {
  const { historyFile } = await temporaryHistoryFile();
  await writeFile(historyFile, '{}', 'utf8');
  await truncate(historyFile, MAX_HISTORY_FILE_BYTES + 1);
  await assert.rejects(loadHistory(historyFile), { code: 'HISTORY_INVALID' });

  await writeFile(historyFile, JSON.stringify({
    schema_version: 1,
    snapshots: Array.from({ length: MAX_HISTORY_SNAPSHOTS + 1 }, (_, index) => ({
      checked_at: new Date(Date.UTC(2026, 6, 1, 0, 0, index)).toISOString(),
    })),
  }), 'utf8');
  await assert.rejects(
    loadHistory(historyFile, { now: new Date('2026-07-14T00:00:00Z') }),
    { code: 'HISTORY_INVALID' },
  );
});

test('summarizes observed pace without treating natural resets as consumption', () => {
  const history = {
    schema_version: 1,
    snapshots: [
      snapshotFromReport(reportAt('2026-07-14T00:00:00Z', 20, 30)),
      snapshotFromReport(reportAt('2026-07-14T01:00:00Z', 30, 32)),
      {
        checked_at: '2026-07-14T02:00:00.000Z',
        five_hour: {
          used_percent: 5,
          resets_at: '2026-07-15T10:00:00.000Z',
        },
        weekly: {
          used_percent: 36,
          resets_at: '2026-07-20T00:00:00.000Z',
        },
      },
    ],
  };

  const summary = summarizeHistory(history);
  assert.equal(summary.snapshot_count, 3);
  assert.equal(summary.first_checked_at, '2026-07-14T00:00:00.000Z');
  assert.equal(summary.last_checked_at, '2026-07-14T02:00:00.000Z');
  assert.equal(summary.five_hour.segment_sample_count, 1);
  assert.equal(summary.five_hour.observed_consumption_percent, 0);
  assert.equal(summary.five_hour.observed_hours, 0);
  assert.equal(summary.five_hour.average_percent_per_hour, null);
  assert.equal(summary.weekly.observed_consumption_percent, 6);
  assert.equal(summary.weekly.observed_hours, 2);
  assert.equal(summary.weekly.average_percent_per_hour, 3);
  assert.equal(summary.weekly.recent_percent_per_hour, 4);
});

test('learns from the current monotonic segment and includes idle time', () => {
  const weekly = (checked_at, used_percent, resets_at = '2026-07-20T00:00:00.000Z') => ({
    checked_at,
    weekly: { used_percent, resets_at },
  });
  const summary = summarizeHistory({
    schema_version: 1,
    snapshots: [
      weekly('2026-07-14T00:00:00.000Z', 20),
      weekly('2026-07-14T01:00:00.000Z', 30),
      weekly('2026-07-14T02:00:00.000Z', 5),
      weekly('2026-07-14T03:00:00.000Z', 5, '2026-07-20T00:00:30.000Z'),
      weekly('2026-07-14T04:00:00.000Z', 9, '2026-07-20T00:00:30.000Z'),
    ],
  });

  assert.equal(summary.weekly.sample_count, 5);
  assert.equal(summary.weekly.segment_sample_count, 3);
  assert.equal(summary.weekly.segment_started_at, '2026-07-14T02:00:00.000Z');
  assert.equal(summary.weekly.observed_consumption_percent, 4);
  assert.equal(summary.weekly.observed_hours, 2);
  assert.equal(summary.weekly.average_percent_per_hour, 2);
  assert.equal(summary.weekly.recent_percent_per_hour, 4);
});

test('deletes history idempotently', async () => {
  const { historyFile } = await temporaryHistoryFile();
  await saveHistory(historyFile, emptyHistory());
  assert.equal(await deleteHistory(historyFile), true);
  assert.equal(await deleteHistory(historyFile), false);
  assert.deepEqual(await loadHistory(historyFile), emptyHistory());
});

test('refuses to delete a file that is not valid usage history', async () => {
  const { historyFile } = await temporaryHistoryFile();
  await writeFile(historyFile, JSON.stringify({
    tokens: { access_token: 'synthetic-but-must-not-be-deleted' },
  }), 'utf8');
  await assert.rejects(deleteHistory(historyFile), {
    code: 'HISTORY_INVALID',
    message: 'Local usage history is not valid.',
  });
  assert.match(await readFile(historyFile, 'utf8'), /must-not-be-deleted/);
});
