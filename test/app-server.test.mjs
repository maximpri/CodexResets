import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeReport, renderJson, renderTable } from '../src/report.mjs';
import {
  fetchAccountDataViaAppServer,
  normalizeAppServerAccountData,
} from '../src/auth.mjs';

const appServerSnapshot = {
  rateLimits: {
    limitId: 'codex',
    planType: 'plus',
    primary: { usedPercent: 8, windowDurationMins: 300, resetsAt: 1787690551 },
    secondary: { usedPercent: 1, windowDurationMins: 10080, resetsAt: 1788277351 },
    rateLimitReachedType: null,
  },
  rateLimitResetCredits: {
    availableCount: 1,
    credits: [{
      id: 'RateLimitResetCredit_synthetic0001',
      resetType: 'codexRateLimits',
      status: 'available',
      grantedAt: 1781654400,
      expiresAt: 1784246400,
      title: 'Full reset (Weekly + 5 hr)',
      description: 'Ready to redeem',
    }],
  },
};

test('adapts the supported app-server rate-limit response for the report normalizer', () => {
  const result = normalizeAppServerAccountData({
    ...appServerSnapshot,
    rateLimitsByLimitId: { codex: appServerSnapshot.rateLimits },
  });

  assert.deepEqual(result, {
    credits: [{
      id: 'RateLimitResetCredit_synthetic0001',
      status: 'available',
      title: 'Full reset (Weekly + 5 hr)',
      description: 'Ready to redeem',
      reset_type: 'codexRateLimits',
      granted_at: 1781654400,
      expires_at: 1784246400,
    }],
    available_count: 1,
    subscription: { plan_type: 'plus' },
    usage: {
      plan_type: 'plus',
      rate_limit: {
        limit_reached: false,
        primary_window: {
          used_percent: 8,
          window_minutes: 300,
          reset_at: 1787690551,
        },
        secondary_window: {
          used_percent: 1,
          window_minutes: 10080,
          reset_at: 1788277351,
        },
      },
    },
  });
});

test('uses the Codex app-server account/rate-limits method for live reads', async () => {
  const calls = [];
  const result = await fetchAccountDataViaAppServer(async (method, params) => {
    calls.push({ method, params });
    return appServerSnapshot;
  });

  assert.deepEqual(calls, [{
    method: 'account/rateLimits/read',
    params: {},
  }]);
  assert.equal(result.usage.rate_limit.primary_window.window_minutes, 300);
  assert.equal(result.credits[0].id, 'RateLimitResetCredit_synthetic0001');
});

test('falls back to the legacy rate-limit window when the bucket map is absent', () => {
  const result = normalizeAppServerAccountData(appServerSnapshot);
  assert.equal(result.usage.rate_limit.secondary_window.window_minutes, 10080);
});

test('rejects an app-server response without rate limits', () => {
  assert.throws(
    () => normalizeAppServerAccountData({ rateLimitResetCredits: { availableCount: 0, credits: [] } }),
    /did not return account rate limits/,
  );
});

test('app-server expiry in Unix seconds stays redeemable through reporting', () => {
  const report = normalizeReport(normalizeAppServerAccountData(appServerSnapshot), {
    now: new Date('2026-07-13T23:25:36Z'), timeZone: 'America/Toronto',
  });
  const json = JSON.parse(renderJson(report));
  assert.equal(json.available_count, 1);
  assert.equal(json.next_saved_full_reset.expires_at, '2026-07-17T00:00:00.000Z');
  assert.equal(json.credits[0].urgency, 'LATER');
  const table = renderTable(report);
  assert.match(table, /Thu 2026-07-16 20:00 EDT/);
  assert.doesNotMatch(table, /1970|NO BANKED RESET AVAILABLE/);
});
