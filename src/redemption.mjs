import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { createInterface as createLineReader } from 'node:readline';
import { createInterface as createPrompt } from 'node:readline/promises';
import { SafeError } from './auth.mjs';

const DUE_ACTIONS = new Set(['USE_NOW', 'USE_NEAR_LIMIT', 'USE_BEFORE_EXPIRY']);
const REDEMPTION_OUTCOMES = new Set([
  'reset',
  'alreadyRedeemed',
  'nothingToReset',
  'noCredit',
]);

export function redemptionKey(report) {
  const credit = report?.nextSavedReset;
  if (!credit) return null;
  return credit.id || credit.expiresAt?.toISOString() || null;
}

export function isRedemptionDue(report) {
  const recommendation = report?.recommendation;
  return Boolean(
    report?.nextSavedReset
      && recommendation?.recommendedAt
      && DUE_ACTIONS.has(recommendation.action)
      && recommendation.recommendedAt.getTime() <= report.checkedAt.getTime(),
  );
}

function resetValueSummary(report) {
  const values = report?.recommendation?.estimatedResetValues ?? {};
  const label = (value) => Number.isInteger(value)
    ? String(value)
    : Number(value).toFixed(1).replace(/\.0$/, '');
  const parts = [
    values.fiveHourPercent === null || values.fiveHourPercent === undefined
      ? null
      : `5-hour ${label(values.fiveHourPercent)} points`,
    values.weeklyPercent === null || values.weeklyPercent === undefined
      ? null
      : `weekly ${label(values.weeklyPercent)} points`,
  ].filter(Boolean);
  return parts.length ? parts.join(', ') : 'the eligible Codex rate-limit window';
}

export async function callCodexAppServer(method, params = {}, dependencies = {}) {
  const spawnImpl = dependencies.spawnImpl ?? spawn;
  const timeoutMs = dependencies.timeoutMs ?? 15_000;

  return new Promise((resolve, reject) => {
    let child;
    let settled = false;
    let requestSent = false;
    let timer;
    let reader;

    const finish = (error, result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reader?.close();
      child?.stdin?.end();
      if (child && !child.killed) child.kill();
      if (error) reject(error);
      else resolve(result);
    };

    const write = (message) => {
      try {
        child.stdin.write(`${JSON.stringify(message)}\n`);
      } catch {
        finish(new SafeError('Could not communicate with the Codex app server.', {
          retryable: true,
        }));
      }
    };

    try {
      child = spawnImpl('codex', ['app-server'], {
        stdio: ['pipe', 'pipe', 'ignore'],
      });
    } catch {
      finish(new SafeError('Could not start the Codex app server. Confirm the Codex CLI is installed.'));
      return;
    }

    child.once('error', () => {
      finish(new SafeError('Could not start the Codex app server. Confirm the Codex CLI is installed.'));
    });
    child.once('exit', () => {
      if (!settled) {
        finish(new SafeError('The Codex app server stopped before completing the reset request.', {
          retryable: true,
        }));
      }
    });
    child.stdin.on('error', () => {
      if (!settled) {
        finish(new SafeError('Could not communicate with the Codex app server.', {
          retryable: true,
        }));
      }
    });

    reader = createLineReader({ input: child.stdout });
    reader.on('line', (line) => {
      let message;
      try {
        message = JSON.parse(line);
      } catch {
        finish(new SafeError('The Codex app server returned an invalid response.', {
          retryable: true,
        }));
        return;
      }

      if (message.id === 1) {
        if (message.error) {
          finish(new SafeError('The Codex app server rejected initialization.'));
          return;
        }
        write({ method: 'initialized', params: {} });
        write({ method, id: 2, params });
        requestSent = true;
        return;
      }

      if (message.id === 2 && requestSent) {
        if (message.error) {
          finish(new SafeError('Codex could not consume the saved reset.'));
          return;
        }
        finish(null, message.result);
      }
    });

    timer = setTimeout(() => {
      finish(new SafeError('The Codex reset request timed out.', { retryable: true }));
    }, timeoutMs);

    write({
      method: 'initialize',
      id: 1,
      params: {
        clientInfo: {
          name: 'codexresets',
          title: 'CodexResets',
          version: '1.0.0',
        },
      },
    });
  });
}

export async function consumeRateLimitReset(options = {}) {
  const idempotencyKey = options.idempotencyKey ?? randomUUID();
  const rpcCall = options.rpcCall ?? callCodexAppServer;
  const creditId = String(options.creditId ?? '');
  const params = {
    idempotencyKey,
    ...(creditId ? { creditId } : {}),
  };
  const result = await rpcCall('account/rateLimitResetCredit/consume', params);
  const outcome = result?.outcome;
  if (!REDEMPTION_OUTCOMES.has(outcome)) {
    throw new SafeError('Codex returned an unknown saved-reset result.');
  }
  return { outcome };
}

export function approvalGranted(answer) {
  return String(answer ?? '').trim().toLowerCase() === 'yes';
}

async function askForApproval(input, output) {
  const prompt = createPrompt({ input, output });
  try {
    const answer = await prompt.question('Type "yes" to consume one banked reset now: ');
    return approvalGranted(answer);
  } finally {
    prompt.close();
  }
}

function canPrompt(options, report, input, terminal) {
  return options.redeemPrompt !== false
    && !options.input
    && !options.fixedNow
    && !options.authFileExplicit
    && (!options.format || options.format === 'table')
    && Boolean(input?.isTTY)
    && Boolean(terminal?.isTTY)
    && isRedemptionDue(report);
}

export async function offerRedemption(report, options = {}, dependencies = {}) {
  const input = dependencies.input ?? process.stdin;
  const terminal = dependencies.terminal ?? process.stdout;
  const output = dependencies.output ?? process.stderr;
  const dismissedKeys = dependencies.dismissedKeys ?? new Set();
  const key = redemptionKey(report);

  if (!canPrompt(options, report, input, terminal) || (key && dismissedKeys.has(key))) {
    return { status: 'not_offered' };
  }

  output.write(`\nA banked reset is ready to use now for ${resetValueSummary(report)}.\n`);
  output.write('Consuming it is permanent and cannot be undone.\n');
  const ask = dependencies.ask ?? (() => askForApproval(input, output));
  const approved = await ask();
  if (!approved) {
    if (key) dismissedKeys.add(key);
    output.write('Saved reset not used.\n');
    return { status: 'declined', creditKey: key };
  }

  const consume = dependencies.consume ?? consumeRateLimitReset;
  const { outcome } = await consume({ creditId: report.nextSavedReset.id });
  if (outcome === 'reset' || outcome === 'alreadyRedeemed') {
    output.write(outcome === 'reset'
      ? 'Saved reset used. Refreshing account limits...\n'
      : 'This reset was already used successfully. Refreshing account limits...\n');
    return { status: 'consumed', outcome, creditKey: key };
  }

  if (key) dismissedKeys.add(key);
  output.write(outcome === 'nothingToReset'
    ? 'No eligible rate-limit window can be reset right now; no reset was consumed.\n'
    : 'No banked reset is available; nothing was consumed.\n');
  return { status: 'not_consumed', outcome, creditKey: key };
}
