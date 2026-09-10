import { randomUUID } from 'node:crypto';
import { createInterface as createPrompt } from 'node:readline/promises';
import { SafeError } from './errors.mjs';
import { callCodexAppServer } from './app-server.mjs';

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
    throw new SafeError('Codex returned an unknown banked-reset result.');
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
    output.write('Banked reset not used.\n');
    return { status: 'declined', creditKey: key };
  }

  const consume = dependencies.consume ?? consumeRateLimitReset;
  const { outcome } = await consume({ creditId: report.nextSavedReset.id });
  if (outcome === 'reset' || outcome === 'alreadyRedeemed') {
    output.write(outcome === 'reset'
      ? 'Banked reset used. Refreshing account limits...\n'
      : 'This reset was already used successfully. Refreshing account limits...\n');
    return { status: 'consumed', outcome, creditKey: key };
  }

  if (key) dismissedKeys.add(key);
  output.write(outcome === 'nothingToReset'
    ? 'No eligible rate-limit window can be reset right now; no reset was consumed.\n'
    : 'No banked reset is available; nothing was consumed.\n');
  return { status: 'not_consumed', outcome, creditKey: key };
}
