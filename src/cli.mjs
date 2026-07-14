#!/usr/bin/env node

import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fetchCredits, SafeError } from './auth.mjs';
import { normalizeReport, renderJson, renderTable, validateTimeZone } from './report.mjs';

const packagePath = fileURLToPath(new URL('../package.json', import.meta.url));

function usage() {
  return `Codex Reset Credits

Usage:
  codex-reset-credits [options]
  ./check-reset-credits.sh [options]

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
  -h, --help               Show this help
  -v, --version            Show the version

Environment:
  CODEX_AUTH_FILE          Alternative auth.json location
  CODEX_HOME               Codex home directory (default: ~/.codex)
  NO_COLOR                 Disable ANSI colors
`;
}

function requireValue(arguments_, index, option) {
  const value = arguments_[index + 1];
  if (!value || value.startsWith('--')) throw new SafeError(`${option} requires a value.`);
  return value;
}

export function parseArguments(arguments_) {
  const detectedColumns = Number.parseInt(process.env.COLUMNS || process.stdout.columns || '96', 10);
  const defaultWidth = Number.isFinite(detectedColumns)
    ? Math.min(96, Math.max(68, detectedColumns))
    : 96;
  const options = {
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
    authFile: process.env.CODEX_AUTH_FILE
      ? resolve(process.env.CODEX_AUTH_FILE)
      : join(process.env.CODEX_HOME || join(homedir(), '.codex'), 'auth.json'),
    format: 'table',
    colorMode: String(process.env.COLOR_MODE || 'auto').toLowerCase(),
    width: defaultWidth,
    showIds: false,
    ascii: false,
    input: null,
    now: new Date(),
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
        index += 1;
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
  try {
    validateTimeZone(options.timeZone);
  } catch (error) {
    throw new SafeError(error.message);
  }
  return options;
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

function colorEnabled(mode) {
  if (mode === 'always') return true;
  if (mode === 'never' || Object.hasOwn(process.env, 'NO_COLOR')) return false;
  return Boolean(process.stdout.isTTY && process.env.TERM !== 'dumb');
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

  const data = options.input ? await readInput(options.input) : await fetchCredits(options.authFile);
  if (!Array.isArray(data?.credits)) {
    throw new SafeError('The response does not contain a credits list. The service format may have changed.');
  }
  const report = normalizeReport(data, { now: options.now, timeZone: options.timeZone });
  const output = options.format === 'json'
    ? renderJson(report, options)
    : renderTable(report, { ...options, color: colorEnabled(options.colorMode) });
  process.stdout.write(output);
}

main().catch((error) => {
  const message = error instanceof SafeError ? error.message : 'Unexpected failure while building the report.';
  process.stderr.write(`Error: ${message}\n`);
  if (!(error instanceof SafeError) && process.env.DEBUG) {
    process.stderr.write(`${error?.stack || error}\n`);
  }
  process.exitCode = 1;
});
