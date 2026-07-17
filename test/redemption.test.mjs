import assert from 'node:assert/strict';
import test from 'node:test';
import {
  approvalGranted,
  consumeRateLimitReset,
  isRedemptionDue,
  offerRedemption,
} from '../src/redemption.mjs';

function dueReport(overrides = {}) {
  const checkedAt = new Date('2026-07-17T12:00:00Z');
  return {
    checkedAt,
    nextSavedReset: {
      id: 'RateLimitResetCredit_synthetic0001',
      expiresAt: new Date('2026-07-18T00:00:00Z'),
    },
    recommendation: {
      action: 'USE_NOW',
      recommendedAt: new Date(checkedAt),
      estimatedResetValues: {
        fiveHourPercent: null,
        weeklyPercent: 95,
      },
    },
    ...overrides,
  };
}

test('requires the full word yes for irreversible redemption approval', () => {
  assert.equal(approvalGranted('yes'), true);
  assert.equal(approvalGranted(' YES '), true);
  assert.equal(approvalGranted('y'), false);
  assert.equal(approvalGranted('sure'), false);
  assert.equal(approvalGranted(''), false);
});

test('offers redemption only when a supported recommendation is due', () => {
  assert.equal(isRedemptionDue(dueReport()), true);
  assert.equal(isRedemptionDue(dueReport({
    recommendation: {
      ...dueReport().recommendation,
      recommendedAt: new Date('2026-07-17T13:00:00Z'),
    },
  })), false);
  assert.equal(isRedemptionDue(dueReport({
    recommendation: {
      ...dueReport().recommendation,
      action: 'WAIT_FOR_WEEKLY_RESET',
    },
  })), false);
  assert.equal(isRedemptionDue(dueReport({ nextSavedReset: null })), false);
});

test('never prompts or consumes in a non-interactive run', async () => {
  let consumed = false;
  const result = await offerRedemption(dueReport(), { format: 'table' }, {
    input: { isTTY: false },
    terminal: { isTTY: false },
    output: { write: () => {} },
    ask: async () => true,
    consume: async () => {
      consumed = true;
      return { outcome: 'reset' };
    },
  });
  assert.deepEqual(result, { status: 'not_offered' });
  assert.equal(consumed, false);
});

test('does not offer redemption for JSON, offline, fixed-time, or disabled runs', async () => {
  const baseDependencies = {
    input: { isTTY: true },
    terminal: { isTTY: true },
    output: { write: () => {} },
    ask: async () => {
      throw new Error('approval prompt should not run');
    },
  };
  for (const options of [
    { format: 'json' },
    { format: 'table', input: 'fixture.json' },
    { format: 'table', fixedNow: true },
    { format: 'table', authFileExplicit: true },
    { format: 'table', redeemPrompt: false },
  ]) {
    assert.deepEqual(
      await offerRedemption(dueReport(), options, baseDependencies),
      { status: 'not_offered' },
    );
  }
});

test('declining leaves the reset untouched and suppresses repeat watch prompts', async () => {
  let output = '';
  let consumeCalls = 0;
  const dismissedKeys = new Set();
  const dependencies = {
    input: { isTTY: true },
    terminal: { isTTY: true },
    output: { write: (value) => { output += value; } },
    dismissedKeys,
    ask: async () => false,
    consume: async () => {
      consumeCalls += 1;
      return { outcome: 'reset' };
    },
  };
  const first = await offerRedemption(dueReport(), { format: 'table' }, dependencies);
  const second = await offerRedemption(dueReport(), { format: 'table' }, dependencies);
  assert.equal(first.status, 'declined');
  assert.equal(second.status, 'not_offered');
  assert.equal(consumeCalls, 0);
  assert.match(output, /permanent and cannot be undone/);
  assert.match(output, /Saved reset not used/);
});

test('approval consumes the selected reset and reports success', async () => {
  let selectedCredit;
  let output = '';
  const result = await offerRedemption(dueReport(), { format: 'table' }, {
    input: { isTTY: true },
    terminal: { isTTY: true },
    output: { write: (value) => { output += value; } },
    ask: async () => true,
    consume: async ({ creditId }) => {
      selectedCredit = creditId;
      return { outcome: 'reset' };
    },
  });
  assert.equal(selectedCredit, 'RateLimitResetCredit_synthetic0001');
  assert.deepEqual(result, {
    status: 'consumed',
    outcome: 'reset',
    creditKey: 'RateLimitResetCredit_synthetic0001',
  });
  assert.match(output, /Saved reset used/);
});

test('redemption sends an idempotency key and the selected opaque credit ID', async () => {
  const calls = [];
  const result = await consumeRateLimitReset({
    creditId: 'RateLimitResetCredit_synthetic0001',
    idempotencyKey: '00000000-0000-4000-8000-000000000001',
    rpcCall: async (method, params) => {
      calls.push({ method, params });
      return { outcome: 'reset' };
    },
  });
  assert.deepEqual(calls, [{
    method: 'account/rateLimitResetCredit/consume',
    params: {
      idempotencyKey: '00000000-0000-4000-8000-000000000001',
      creditId: 'RateLimitResetCredit_synthetic0001',
    },
  }]);
  assert.deepEqual(result, { outcome: 'reset' });
});

test('rejects unknown app-server outcomes without exposing response details', async () => {
  await assert.rejects(
    consumeRateLimitReset({
      rpcCall: async () => ({ outcome: 'syntheticUnexpected', private: 'do-not-print' }),
    }),
    (error) => /unknown saved-reset result/.test(error.message)
      && !error.message.includes('do-not-print'),
  );
});

test('nothing-to-reset and no-credit outcomes do not claim consumption', async () => {
  for (const outcome of ['nothingToReset', 'noCredit']) {
    let output = '';
    const result = await offerRedemption(dueReport(), { format: 'table' }, {
      input: { isTTY: true },
      terminal: { isTTY: true },
      output: { write: (value) => { output += value; } },
      ask: async () => true,
      consume: async () => ({ outcome }),
    });
    assert.equal(result.status, 'not_consumed');
    assert.match(output, /nothing was consumed|no reset was consumed/);
  }
});
