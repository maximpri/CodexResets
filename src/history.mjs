import { randomUUID } from 'node:crypto';
import {
  chmod,
  mkdir,
  open,
  rename,
  unlink,
} from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, dirname, join } from 'node:path';

export const HISTORY_SCHEMA_VERSION = 1;
export const MAX_HISTORY_SNAPSHOTS = 2_000;
export const HISTORY_RETENTION_DAYS = 90;
export const HISTORY_RECORD_BUCKET_MS = 15 * 60 * 1_000;
export const MAX_HISTORY_FILE_BYTES = 2 * 1_024 * 1_024;

const DAY_MS = 24 * 60 * 60 * 1_000;
const HISTORY_RETENTION_MS = HISTORY_RETENTION_DAYS * DAY_MS;
const HISTORY_FILENAME = 'reset-credits-history.json';
const RESET_EPOCH_TOLERANCE_MS = 60 * 1_000;

const ERROR_MESSAGES = {
  HISTORY_DELETE_FAILED: 'Could not delete local usage history.',
  HISTORY_INVALID: 'Local usage history is not valid.',
  HISTORY_INVALID_REPORT: 'The usage report cannot be recorded safely.',
  HISTORY_READ_FAILED: 'Could not read local usage history.',
  HISTORY_WRITE_FAILED: 'Could not save local usage history.',
};

/**
 * An error whose message is safe to show directly to a user.
 *
 * Deliberately do not attach the underlying filesystem or JSON error as a
 * cause: those errors can contain local paths or fragments of private data.
 */
export class HistoryError extends Error {
  constructor(code) {
    super(ERROR_MESSAGES[code] ?? 'Local usage history could not be processed.');
    this.name = 'HistoryError';
    this.code = code;
  }
}

export function defaultHistoryPath(env = process.env) {
  const codexHome = typeof env?.CODEX_HOME === 'string' && env.CODEX_HOME
    ? env.CODEX_HOME
    : join(homedir(), '.codex');
  return join(codexHome, HISTORY_FILENAME);
}

export function emptyHistory() {
  return {
    schema_version: HISTORY_SCHEMA_VERSION,
    snapshots: [],
  };
}

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function hasOnlyKeys(value, allowed) {
  return Object.keys(value).every((key) => allowed.has(key));
}

function isoTimestamp(value, { stored = false } = {}) {
  if (stored && typeof value !== 'string') return null;
  if (!(value instanceof Date) && typeof value !== 'string') return null;
  const date = value instanceof Date ? new Date(value) : new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

function normalizeWindow(value, { strict = false, report = false } = {}) {
  if (!isRecord(value)) return null;

  if (strict && !hasOnlyKeys(value, new Set(['used_percent', 'resets_at']))) return null;

  const usedPercent = report ? value.usedPercent ?? value.used_percent : value.used_percent;
  const resetsAt = report ? value.resetsAt ?? value.resets_at : value.resets_at;
  if (typeof usedPercent !== 'number'
    || !Number.isFinite(usedPercent)
    || usedPercent < 0
    || usedPercent > 100) return null;

  const normalizedReset = isoTimestamp(resetsAt, { stored: strict });
  if (!normalizedReset) return null;
  return {
    used_percent: usedPercent,
    resets_at: normalizedReset,
  };
}

function normalizeStoredSnapshot(value, { strict = false } = {}) {
  if (!isRecord(value)) return null;
  if (strict && !hasOnlyKeys(value, new Set(['checked_at', 'five_hour', 'weekly']))) {
    return null;
  }

  const checkedAt = isoTimestamp(value.checked_at, { stored: strict });
  if (!checkedAt) return null;
  const snapshot = { checked_at: checkedAt };

  for (const name of ['five_hour', 'weekly']) {
    if (value[name] === undefined) continue;
    const usageWindow = normalizeWindow(value[name], { strict });
    if (!usageWindow) return null;
    snapshot[name] = usageWindow;
  }
  return snapshot;
}

function normalizeHistory(value, { strict = false, enforceLimit = false } = {}) {
  if (!isRecord(value)) throw new HistoryError('HISTORY_INVALID');
  if (strict && !hasOnlyKeys(value, new Set(['schema_version', 'snapshots']))) {
    throw new HistoryError('HISTORY_INVALID');
  }
  if (value.schema_version !== HISTORY_SCHEMA_VERSION || !Array.isArray(value.snapshots)) {
    throw new HistoryError('HISTORY_INVALID');
  }
  if (enforceLimit && value.snapshots.length > MAX_HISTORY_SNAPSHOTS) {
    throw new HistoryError('HISTORY_INVALID');
  }

  const snapshots = value.snapshots.map((snapshot) => normalizeStoredSnapshot(snapshot, { strict }));
  if (snapshots.some((snapshot) => snapshot === null)) {
    throw new HistoryError('HISTORY_INVALID');
  }
  return {
    schema_version: HISTORY_SCHEMA_VERSION,
    snapshots,
  };
}

function retentionAnchor(value) {
  const normalized = isoTimestamp(value);
  if (!normalized) throw new HistoryError('HISTORY_INVALID');
  return new Date(normalized).getTime();
}

function compactHistory(history, now) {
  const cutoff = retentionAnchor(now) - HISTORY_RETENTION_MS;
  const byTimestamp = new Map();

  for (const snapshot of history.snapshots) {
    const checkedAt = new Date(snapshot.checked_at).getTime();
    if (checkedAt >= cutoff && checkedAt <= cutoff + HISTORY_RETENTION_MS) {
      // Later entries deliberately win when the same instant was recorded twice.
      byTimestamp.set(snapshot.checked_at, snapshot);
    }
  }

  const snapshots = [...byTimestamp.values()]
    .sort((left, right) => left.checked_at.localeCompare(right.checked_at))
    .slice(-MAX_HISTORY_SNAPSHOTS);
  return {
    schema_version: HISTORY_SCHEMA_VERSION,
    snapshots,
  };
}

export function snapshotFromReport(report) {
  try {
    if (!isRecord(report)) throw new HistoryError('HISTORY_INVALID_REPORT');
    const checkedAt = isoTimestamp(report.checkedAt ?? report.checked_at);
    if (!checkedAt) throw new HistoryError('HISTORY_INVALID_REPORT');

    const snapshot = { checked_at: checkedAt };
    const windows = [
      ['five_hour', report.fiveHourUsage ?? report.five_hour_usage],
      ['weekly', report.weeklyUsage ?? report.weekly_usage],
    ];
    for (const [name, value] of windows) {
      if (value === null || value === undefined) continue;
      const usageWindow = normalizeWindow(value, { report: true });
      if (!usageWindow) throw new HistoryError('HISTORY_INVALID_REPORT');
      snapshot[name] = usageWindow;
    }
    return snapshot;
  } catch (error) {
    if (error instanceof HistoryError) throw error;
    throw new HistoryError('HISTORY_INVALID_REPORT');
  }
}

export async function loadHistory(
  historyFile = defaultHistoryPath(),
  { now = new Date() } = {},
) {
  let handle;
  let text;
  try {
    handle = await open(historyFile, 'r');
    const metadata = await handle.stat();
    if (!metadata.isFile() || metadata.size > MAX_HISTORY_FILE_BYTES) {
      throw new HistoryError('HISTORY_INVALID');
    }
    text = await handle.readFile('utf8');
  } catch (error) {
    if (error?.code === 'ENOENT') return emptyHistory();
    if (error instanceof HistoryError) throw error;
    throw new HistoryError('HISTORY_READ_FAILED');
  } finally {
    if (handle) await handle.close().catch(() => {});
  }

  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new HistoryError('HISTORY_INVALID');
  }
  return compactHistory(
    normalizeHistory(parsed, { strict: true, enforceLimit: true }),
    now,
  );
}

export async function saveHistory(
  historyFile = defaultHistoryPath(),
  history,
  { now = new Date() } = {},
) {
  let normalized;
  try {
    normalized = compactHistory(normalizeHistory(history), now);
  } catch (error) {
    if (error instanceof HistoryError) throw error;
    throw new HistoryError('HISTORY_INVALID');
  }

  const directory = dirname(historyFile);
  const temporary = join(
    directory,
    `.${basename(historyFile)}.${process.pid}.${randomUUID()}.tmp`,
  );
  let handle;
  try {
    await mkdir(directory, { recursive: true, mode: 0o700 });
    handle = await open(temporary, 'wx', 0o600);
    await handle.writeFile(`${JSON.stringify(normalized, null, 2)}\n`, 'utf8');
    await handle.sync();
    await handle.close();
    handle = undefined;
    await chmod(temporary, 0o600);
    await rename(temporary, historyFile);
    await chmod(historyFile, 0o600);
    return normalized;
  } catch {
    if (handle) await handle.close().catch(() => {});
    await unlink(temporary).catch(() => {});
    throw new HistoryError('HISTORY_WRITE_FAILED');
  }
}

export async function recordHistory(
  historyFile = defaultHistoryPath(),
  report,
  { now = new Date() } = {},
) {
  const snapshot = snapshotFromReport(report);
  const history = await loadHistory(historyFile, { now });
  const snapshots = [...history.snapshots];
  const previous = snapshots.at(-1);
  const sameBucket = previous
    && Math.floor(new Date(previous.checked_at).getTime() / HISTORY_RECORD_BUCKET_MS)
      === Math.floor(new Date(snapshot.checked_at).getTime() / HISTORY_RECORD_BUCKET_MS);
  const sameResetEpochs = previous && ['five_hour', 'weekly'].every((name) => {
    if (!previous[name] && !snapshot[name]) return true;
    if (!previous[name] || !snapshot[name]) return false;
    return Math.abs(new Date(previous[name].resets_at) - new Date(snapshot[name].resets_at))
      <= RESET_EPOCH_TOLERANCE_MS;
  });
  if (sameBucket && sameResetEpochs) snapshots[snapshots.length - 1] = snapshot;
  else snapshots.push(snapshot);
  return saveHistory(
    historyFile,
    {
      schema_version: HISTORY_SCHEMA_VERSION,
      snapshots,
    },
    { now },
  );
}

function summarizeWindow(snapshots, name) {
  const samples = snapshots.filter((snapshot) => snapshot[name]);
  if (!samples.length) return null;

  // Forecast from the current monotonic segment only. A changed reset epoch or
  // a percentage drop means a natural/manual reset (or a server correction)
  // occurred, and older observations no longer describe the active window.
  let segmentStart = 0;
  for (let index = 1; index < samples.length; index += 1) {
    const previous = samples[index - 1][name];
    const current = samples[index][name];
    const resetShift = Math.abs(new Date(current.resets_at) - new Date(previous.resets_at));
    if (resetShift > RESET_EPOCH_TOLERANCE_MS
      || current.used_percent < previous.used_percent) {
      segmentStart = index;
    }
  }
  const segment = samples.slice(segmentStart);
  let observedConsumptionPercent = 0;
  let observedHours = 0;
  let recentPercentPerHour = null;
  for (let index = 1; index < segment.length; index += 1) {
    const previous = segment[index - 1];
    const current = segment[index];
    const elapsedHours = (new Date(current.checked_at) - new Date(previous.checked_at)) / (60 * 60 * 1_000);
    const consumed = current[name].used_percent - previous[name].used_percent;
    if (!(elapsedHours > 0)) continue;
    observedHours += elapsedHours;
    observedConsumptionPercent += consumed;
    recentPercentPerHour = consumed / elapsedHours;
  }

  const latest = samples.at(-1)[name];
  return {
    sample_count: samples.length,
    segment_sample_count: segment.length,
    segment_started_at: segment[0].checked_at,
    latest_used_percent: latest.used_percent,
    latest_resets_at: latest.resets_at,
    observed_consumption_percent: observedConsumptionPercent,
    observed_hours: observedHours,
    average_percent_per_hour: observedHours > 0
      ? observedConsumptionPercent / observedHours
      : null,
    recent_percent_per_hour: recentPercentPerHour,
  };
}

export function summarizeHistory(history) {
  const normalized = normalizeHistory(history);
  const snapshots = [...normalized.snapshots]
    .sort((left, right) => left.checked_at.localeCompare(right.checked_at));
  return {
    schema_version: HISTORY_SCHEMA_VERSION,
    snapshot_count: snapshots.length,
    first_checked_at: snapshots[0]?.checked_at ?? null,
    last_checked_at: snapshots.at(-1)?.checked_at ?? null,
    five_hour: summarizeWindow(snapshots, 'five_hour'),
    weekly: summarizeWindow(snapshots, 'weekly'),
  };
}

export async function deleteHistory(historyFile = defaultHistoryPath()) {
  try {
    // Validate the allowlisted schema before unlinking so a mistaken
    // --history-file value cannot delete auth.json or an arbitrary file.
    await loadHistory(historyFile);
    await unlink(historyFile);
    return true;
  } catch (error) {
    if (error?.code === 'ENOENT') return false;
    if (error instanceof HistoryError) throw error;
    throw new HistoryError('HISTORY_DELETE_FAILED');
  }
}
