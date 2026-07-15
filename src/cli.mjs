#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { realpathSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fetchAccountData, SafeError } from './auth.mjs';
import {
  deleteHistory,
  defaultHistoryPath,
  emptyHistory,
  HistoryError,
  legacyHistoryPath,
  loadHistory,
  migrateHistoryFile,
  recordHistory,
  summarizeHistory,
} from './history.mjs';
import { normalizeReport, renderJson, renderTable, validateTimeZone } from './report.mjs';

const packagePath = fileURLToPath(new URL('../package.json', import.meta.url));

function usage() {
  return `CodexResets

Usage:
  codexresets [options]
  ./codexresets.sh [options]

Options:
  --timezone <IANA name>   Display time zone (default: system time zone)
  --auth-file <path>       Codex auth.json location
  --format <table|json>    Output format (default: table)
  --color <auto|always|never>
                           ANSI color mode (default: auto)
  --width <68-120>         Report width (default: terminal width, up to 96)
  --show-ids               Include credit IDs (hidden by default)
  --ascii                  Use ASCII borders
  --input <path|->         Render saved JSON without accessing credentials
  --now <ISO timestamp>    Override report time (useful for snapshots)
  --record                 Save a sanitized usage snapshot for better forecasts
  --history                Show the sanitized local history summary and exit
  --forget-history         Delete locally recorded usage history and exit
  --history-file <path>    Alternative sanitized history file
  --watch <duration>        Poll every 1m to 24h; print material changes
  --notify                 Ring the terminal bell when watch output changes
  -h, --help               Show this help
  -v, --version            Show the version

Environment:
  CODEX_AUTH_FILE          Alternative auth.json location
  CODEX_HISTORY_FILE       Alternative sanitized usage-history location
  CODEX_HOME               Codex home directory (default: ~/.codex)
  NO_COLOR                 Disable ANSI colors
`;
}

function requireValue(arguments_, index, option) {
  const value = arguments_[index + 1];
  if (!value || value.startsWith('--')) throw new SafeError(`${option} requires a value.`);
  return value;
}

export function parseInterval(value) {
  const match = /^(\d+)(s|m|h)$/.exec(String(value).toLowerCase());
  if (!match) throw new SafeError('--watch must use a duration such as 1m, 5m, or 1h.');
  const multiplier = { s: 1000, m: 60_000, h: 3_600_000 }[match[2]];
  const milliseconds = Number(match[1]) * multiplier;
  if (!Number.isSafeInteger(milliseconds) || milliseconds < 60_000) {
    throw new SafeError('--watch must be at least 1 minute.');
  }
  if (milliseconds > 24 * 3_600_000) {
    throw new SafeError('--watch cannot exceed 24 hours.');
  }
  return milliseconds;
}

export function parseArguments(arguments_) {
  const detectedColumns = Number.parseInt(process.env.COLUMNS || process.stdout.columns || '96', 10);
  const codexHome = process.env.CODEX_HOME || join(homedir(), '.codex');
  const defaultAuthFile = join(codexHome, 'auth.json');
  const defaultWidth = Number.isFinite(detectedColumns)
    ? Math.min(96, Math.max(68, detectedColumns))
    : 96;
  const options = {
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
    authFile: process.env.CODEX_AUTH_FILE
      ? resolve(process.env.CODEX_AUTH_FILE)
      : defaultAuthFile,
    format: 'table',
    colorMode: String(process.env.COLOR_MODE || 'auto').toLowerCase(),
    width: defaultWidth,
    showIds: false,
    ascii: false,
    input: null,
    historyFile: process.env.CODEX_HISTORY_FILE
      ? resolve(process.env.CODEX_HISTORY_FILE)
      : defaultHistoryPath(),
    legacyHistoryFile: process.env.CODEX_HISTORY_FILE ? null : legacyHistoryPath(),
    historyFileExplicit: Boolean(process.env.CODEX_HISTORY_FILE),
    record: false,
    showHistory: false,
    forgetHistory: false,
    watchMs: null,
    notify: false,
    now: new Date(),
    fixedNow: false,
    help: false,
    version: false,
  };

  for (let index = 0; index < arguments_.length; index += 1) {
    const argument = arguments_[index];
    switch (argument) {
      case '--timezone':
        options.timeZone = requireValue(arguments_, index, argument);
        index += 1;
        break;
      case '--auth-file':
        options.authFile = resolve(requireValue(arguments_, index, argument));
        index += 1;
        break;
      case '--format':
        options.format = requireValue(arguments_, index, argument);
        index += 1;
        break;
      case '--color':
        options.colorMode = requireValue(arguments_, index, argument).toLowerCase();
        index += 1;
        break;
      case '--width':
        options.width = Number.parseInt(requireValue(arguments_, index, argument), 10);
        index += 1;
        break;
      case '--input':
        options.input = requireValue(arguments_, index, argument);
        index += 1;
        break;
      case '--now':
        options.now = new Date(requireValue(arguments_, index, argument));
        options.fixedNow = true;
        index += 1;
        break;
      case '--history-file':
        options.historyFile = resolve(requireValue(arguments_, index, argument));
        options.legacyHistoryFile = null;
        options.historyFileExplicit = true;
        index += 1;
        break;
      case '--watch':
        options.watchMs = parseInterval(requireValue(arguments_, index, argument));
        index += 1;
        break;
      case '--record':
        options.record = true;
        break;
      case '--history':
        options.showHistory = true;
        break;
      case '--forget-history':
        options.forgetHistory = true;
        break;
      case '--notify':
        options.notify = true;
        break;
      case '--show-ids':
        options.showIds = true;
        break;
      case '--ascii':
        options.ascii = true;
        break;
      case '-h':
      case '--help':
        options.help = true;
        break;
      case '-v':
      case '--version':
        options.version = true;
        break;
      default:
        throw new SafeError(`Unknown option: ${argument}`);
    }
  }

  if (!['table', 'json'].includes(options.format)) {
    throw new SafeError('--format must be table or json.');
  }
  if (!['auto', 'always', 'never'].includes(options.colorMode)) {
    throw new SafeError('--color must be auto, always, or never.');
  }
  if (!Number.isFinite(options.width) || options.width < 68 || options.width > 120) {
    throw new SafeError('--width must be between 68 and 120.');
  }
  if (!Number.isFinite(options.now.getTime())) throw new SafeError('--now must be a valid timestamp.');
  if (!options.historyFileExplicit && resolve(options.authFile) !== resolve(defaultAuthFile)) {
    const scope = createHash('sha256').update(resolve(options.authFile)).digest('hex').slice(0, 12);
    options.historyFile = join(codexHome, `codexresets-history-${scope}.json`);
    options.legacyHistoryFile = join(codexHome, `reset-credits-history-${scope}.json`);
  }
  if (resolve(options.historyFile) === resolve(options.authFile)) {
    throw new SafeError('The history file must be different from the credential file.');
  }
  if (options.showHistory && options.forgetHistory) {
    throw new SafeError('--history and --forget-history cannot be used together.');
  }
  if ((options.showHistory || options.forgetHistory)
    && (options.input || options.record || options.watchMs !== null || options.notify)) {
    throw new SafeError('History maintenance options cannot be combined with report options.');
  }
  if (options.notify && options.watchMs === null) {
    throw new SafeError('--notify requires --watch.');
  }
  if (options.record && options.input) {
    throw new SafeError('--record cannot be used with offline --input data.');
  }
  if (options.record && options.fixedNow) {
    throw new SafeError('--record cannot be combined with --now.');
  }
  if (options.watchMs !== null && options.format === 'json') {
    throw new SafeError('--watch currently supports table output only.');
  }
  if (options.watchMs !== null && options.fixedNow) {
    throw new SafeError('--watch cannot be combined with --now.');
  }
  if (options.watchMs !== null && options.input) {
    throw new SafeError('--watch requires live account data and cannot be combined with --input.');
  }
  try {
    validateTimeZone(options.timeZone);
  } catch (error) {
    throw new SafeError(error.message);
  }
  return options;
}

function historySummaryText(summary) {
  const oldest = summary.first_checked_at ?? 'none';
  const latest = summary.last_checked_at ?? 'none';
  return [
    'Sanitized usage history',
    `Snapshots: ${summary.snapshot_count}`,
    `Five-hour samples: ${summary.five_hour?.sample_count ?? 0}`,
    `Weekly samples: ${summary.weekly?.sample_count ?? 0}`,
    `Oldest: ${oldest}`,
    `Latest: ${latest}`,
    '',
  ].join('\n');
}

function recommendationFingerprint(report) {
  const timeBucket = (date) => {
    if (!date) return null;
    const remaining = date - report.checkedAt;
    if (remaining <= 0) return 'now';
    if (remaining <= 60 * 60_000) return 'within_1h';
    if (remaining <= 6 * 60 * 60_000) return 'within_6h';
    if (remaining <= 24 * 60 * 60_000) return 'within_24h';
    return 'later';
  };
  return JSON.stringify({
    action: report.recommendation.action,
    constrainingWindow: report.recommendation.constrainingWindow,
    recommendedIn: timeBucket(report.recommendation.recommendedAt),
    nextExpiry: report.nextSavedReset?.expiresAt?.toISOString() ?? null,
    nextUrgency: report.nextSavedReset?.urgency ?? null,
  });
}

function terminalSafeDiagnostic(value, { preserveWhitespace = false } = {}) {
  return String(value ?? '').replace(
    /[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/g,
    (character) => preserveWhitespace && (character === '\n' || character === '\t')
      ? character
      : '?',
  );
}

function sanitizedDebugStack(error) {
  const lines = String(error?.stack || error).split('\n');
  if (lines.length) lines[0] = String(error?.name || 'Error');
  return terminalSafeDiagnostic(lines.join('\n')
    .replaceAll(process.cwd(), '<project>')
    .replaceAll(homedir(), '<home>'), { preserveWhitespace: true });
}

async function readInput(path) {
  let text;
  try {
    if (path === '-') {
      const chunks = [];
      for await (const chunk of process.stdin) chunks.push(chunk);
      text = Buffer.concat(chunks).toString('utf8');
    } else {
      text = await readFile(resolve(path), 'utf8');
    }
    return JSON.parse(text);
  } catch (error) {
    if (error instanceof SyntaxError) throw new SafeError('The input is not valid JSON.');
    throw new SafeError(`Could not read input from ${path}.`, { cause: error });
  }
}

let historyWarningShown = false;

async function readUsageHistory(path, { fallback = false } = {}) {
  try {
    return await loadHistory(path);
  } catch (error) {
    if (error instanceof HistoryError && fallback) {
      if (!historyWarningShown) {
        process.stderr.write('Warning: local usage history is unavailable; using the window average.\n');
        historyWarningShown = true;
      }
      return emptyHistory();
    }
    if (error instanceof HistoryError) throw new SafeError(error.message, { cause: error });
    throw error;
  }
}

async function saveUsageSnapshot(path, report) {
  try {
    await recordHistory(path, report);
  } catch (error) {
    if (error instanceof HistoryError) throw new SafeError(error.message, { cause: error });
    throw error;
  }
}

async function migrateUsageHistory(options, { fallback = false } = {}) {
  if (!options.legacyHistoryFile) return;
  try {
    await migrateHistoryFile(options.legacyHistoryFile, options.historyFile);
  } catch (error) {
    if (error instanceof HistoryError && fallback) {
      if (!historyWarningShown) {
        process.stderr.write('Warning: legacy usage history migration was incomplete; continuing with available sanitized history.\n');
        historyWarningShown = true;
      }
      return;
    }
    if (error instanceof HistoryError) throw new SafeError(error.message, { cause: error });
    throw error;
  }
}

async function removeUsageHistory(path) {
  try {
    return await deleteHistory(path);
  } catch (error) {
    if (error instanceof HistoryError) throw new SafeError(error.message, { cause: error });
    throw error;
  }
}

function colorEnabled(mode) {
  if (mode === 'always') return true;
  if (mode === 'never' || Object.hasOwn(process.env, 'NO_COLOR')) return false;
  return Boolean(process.stdout.isTTY && process.env.TERM !== 'dumb');
}

async function buildReport(options) {
  if (!options.input) await migrateUsageHistory(options, { fallback: !options.record });
  const history = options.input
    ? emptyHistory()
    : await readUsageHistory(options.historyFile, { fallback: !options.record });
  const data = options.input ? await readInput(options.input) : await fetchAccountData(options.authFile);
  if (!Array.isArray(data?.credits)) {
    throw new SafeError('The response does not contain a credits list. The service format may have changed.');
  }
  const now = options.fixedNow ? options.now : new Date();
  const report = normalizeReport(data, {
    now,
    timeZone: options.timeZone,
    history: history.snapshots,
  });
  if (options.record) await saveUsageSnapshot(options.historyFile, report);
  return report;
}

function renderReport(report, options) {
  return options.format === 'json'
    ? renderJson(report, options)
    : renderTable(report, { ...options, color: colorEnabled(options.colorMode) });
}

const wait = (milliseconds) => new Promise((resolveWait) => setTimeout(resolveWait, milliseconds));

function safeMessage(error) {
  const message = error instanceof SafeError
    ? error.message
    : 'Unexpected failure while building the report.';
  return terminalSafeDiagnostic(message);
}

export async function watchReports(options, dependencies = {}) {
  const build = dependencies.buildReport ?? buildReport;
  const render = dependencies.renderReport ?? renderReport;
  const sleep = dependencies.wait ?? wait;
  const stdout = dependencies.stdout ?? process.stdout;
  const stderr = dependencies.stderr ?? process.stderr;
  const maximumIterations = dependencies.maximumIterations ?? Number.POSITIVE_INFINITY;
  let lastFingerprint = null;
  let completedIterations = 0;
  let consecutiveFailures = 0;
  let attempts = 0;

  while (attempts < maximumIterations) {
    attempts += 1;
    try {
      const report = await build(options);
      const fingerprint = recommendationFingerprint(report);
      if (fingerprint !== lastFingerprint) {
        if (completedIterations && options.notify && stdout.isTTY) stderr.write('\u0007');
        if (completedIterations) stdout.write('\n');
        stdout.write(render(report, options));
        lastFingerprint = fingerprint;
      }
      completedIterations += 1;
      consecutiveFailures = 0;
    } catch (error) {
      if (!completedIterations || !(error instanceof SafeError) || !error.retryable) throw error;
      stderr.write(`Watch warning: ${safeMessage(error)}\n`);
      consecutiveFailures += 1;
    }
    if (attempts >= maximumIterations) break;
    const delay = consecutiveFailures === 0
      ? options.watchMs
      : Math.min(
        options.watchMs * (2 ** Math.min(consecutiveFailures, 4)),
        Math.max(options.watchMs, 15 * 60_000),
      );
    await sleep(delay);
  }
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  if (options.help) {
    process.stdout.write(usage());
    return;
  }
  if (options.version) {
    const packageJson = JSON.parse(await readFile(packagePath, 'utf8'));
    process.stdout.write(`${packageJson.version}\n`);
    return;
  }
  if (options.showHistory) {
    await migrateUsageHistory(options);
    const history = await readUsageHistory(options.historyFile);
    process.stdout.write(historySummaryText(summarizeHistory(history)));
    return;
  }
  if (options.forgetHistory) {
    await migrateUsageHistory(options);
    const deleted = await removeUsageHistory(options.historyFile);
    process.stdout.write(deleted ? 'Sanitized usage history deleted.\n' : 'No usage history was stored.\n');
    return;
  }
  if (options.watchMs === null) {
    process.stdout.write(renderReport(await buildReport(options), options));
    return;
  }

  await watchReports(options);
}

function canonicalPath(path) {
  try {
    return realpathSync(path);
  } catch {
    return resolve(path);
  }
}

const entryPoint = process.argv[1] ? canonicalPath(process.argv[1]) : '';
const modulePath = canonicalPath(fileURLToPath(import.meta.url));
if (entryPoint === modulePath) {
  main().catch((error) => {
    process.stderr.write(`Error: ${safeMessage(error)}\n`);
    if (!(error instanceof SafeError) && process.env.DEBUG) {
      process.stderr.write(`${sanitizedDebugStack(error)}\n`);
    }
    process.exitCode = 1;
  });
}
