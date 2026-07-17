import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  formatDuration,
  normalizeReport,
  renderJson,
  renderTable,
  urgencyFor,
} from '../src/report.mjs';

const fixture = JSON.parse(await readFile(new URL('fixtures/credits.json', import.meta.url), 'utf8'));
const now = new Date('2026-07-13T23:25:36Z');

test('normalizes and sorts available credits without trusting total_earned_count', () => {
  const report = normalizeReport(fixture, { now, timeZone: 'UTC' });
  assert.equal(report.credits.length, 3);
  assert.equal(report.credits[0].id, 'RateLimitResetCredit_example00000001');
  assert.equal(Object.hasOwn(report, 'totalEarned'), false);
});

test('normalizes weekly usage and projects depletion with a day/night-weighted pace', () => {
  const report = normalizeReport(fixture, { now, timeZone: 'UTC' });
  assert.equal(report.fiveHourUsage.usedPercent, 20);
  assert.equal(report.fiveHourUsage.remainingPercent, 80);
  assert.equal(report.fiveHourUsage.resetsAt.toISOString(), '2026-07-14T03:00:00.000Z');
  assert.ok(Math.abs(report.fiveHourUsage.averagePercentPerHour - 21.57) < 0.01);
  assert.equal(report.fiveHourUsage.exhaustsBeforeReset, false);
  assert.equal(report.weeklyUsage.usedPercent, 20);
  assert.equal(report.weeklyUsage.remainingPercent, 80);
  assert.equal(report.weeklyUsage.resetsAt.toISOString(), '2026-07-20T00:00:00.000Z');
  assert.ok(Math.abs(report.weeklyUsage.averagePercentPerDay - 20.32) < 0.01);
  assert.equal(report.weeklyUsage.estimatedExhaustionAt.toISOString(), '2026-07-17T21:32:57.600Z');
  assert.equal(report.weeklyUsage.exhaustsBeforeReset, true);
  assert.equal(report.recommendation.action, 'USE_NEAR_LIMIT');
  assert.equal(report.recommendation.projectedUsagePercent, 95);
  assert.equal(report.recommendation.estimatedResetValuePercent, 95);
  assert.equal(report.nextSavedReset.id, 'RateLimitResetCredit_example00000001');
});

test('finds a weekly secondary window when the primary window is shorter', () => {
  const data = {
    credits: [],
    usage: {
      rate_limit: {
        primary_window: {
          used_percent: 90,
          limit_window_seconds: 18_000,
          reset_at: Date.parse('2026-07-14T04:00:00Z') / 1000,
        },
        secondary_window: {
          used_percent: 25,
          limit_window_seconds: 604_800,
          reset_at: Date.parse('2026-07-20T00:00:00Z') / 1000,
        },
      },
    },
  };
  const report = normalizeReport(data, { now, timeZone: 'UTC' });
  assert.equal(report.fiveHourUsage.kind, 'primary');
  assert.equal(report.fiveHourUsage.usedPercent, 90);
  assert.equal(report.weeklyUsage.kind, 'secondary');
  assert.equal(report.weeklyUsage.usedPercent, 25);
});

test('lets the five-hour window drive an earlier near-limit recommendation', () => {
  const data = structuredClone(fixture);
  data.usage.rate_limit.primary_window.used_percent = 80;
  const report = normalizeReport(data, { now, timeZone: 'UTC' });
  assert.equal(report.recommendation.action, 'USE_NEAR_LIMIT');
  assert.equal(report.recommendation.constrainingWindow, 'five_hour');
  assert.ok(report.recommendation.recommendedAt < report.fiveHourUsage.resetsAt);
  assert.equal(report.recommendation.estimatedResetValues.fiveHourPercent, 95);
  assert.ok(report.recommendation.estimatedResetValues.weeklyPercent > 20);
});

test('analyzes a five-hour window when weekly usage is unavailable', () => {
  const data = {
    credits: [{
      status: 'available',
      title: 'Full reset',
      expires_at: '2026-07-15T12:00:00Z',
    }],
    usage: {
      rate_limit: {
        primary_window: {
          used_percent: 10,
          limit_window_seconds: 18_000,
          reset_at: Date.parse('2026-07-14T03:00:00Z') / 1000,
        },
      },
    },
  };
  const report = normalizeReport(data, { now, timeZone: 'UTC' });
  assert.equal(report.weeklyUsage, null);
  assert.equal(report.fiveHourUsage.usedPercent, 10);
  assert.equal(report.recommendation.action, 'WAIT_FOR_FIVE_HOUR_RESET');
  assert.equal(report.recommendation.constrainingWindow, 'five_hour');
});

test('moves reset advice before an expiring saved credit', () => {
  const data = {
    credits: [{
      id: 'synthetic-expiring',
      status: 'available',
      title: 'Full reset',
      expires_at: '2026-07-15T00:00:00Z',
    }],
    usage: {
      rate_limit: {
        primary_window: {
          used_percent: 40,
          limit_window_seconds: 604_800,
          reset_at: Date.parse('2026-07-20T00:00:00Z') / 1000,
        },
      },
    },
  };
  const report = normalizeReport(data, { now, timeZone: 'UTC' });
  assert.equal(report.recommendation.action, 'USE_BEFORE_EXPIRY');
  assert.equal(report.recommendation.recommendedAt.toISOString(), '2026-07-14T23:45:00.000Z');
  assert.ok(report.recommendation.projectedUsagePercent > 40);
});

test('uses an expiring credit for its projected recovery value even without depletion', () => {
  const data = {
    credits: [{
      status: 'available',
      title: 'Full reset',
      expires_at: '2026-07-15T12:00:00Z',
    }],
    usage: {
      rate_limit: {
        primary_window: {
          used_percent: 10,
          limit_window_seconds: 604_800,
          reset_at: Date.parse('2026-07-20T00:00:00Z') / 1000,
        },
      },
    },
  };
  const report = normalizeReport(data, { now, timeZone: 'UTC' });
  assert.equal(report.weeklyUsage.exhaustsBeforeReset, false);
  assert.equal(report.recommendation.action, 'USE_BEFORE_EXPIRY');
  assert.equal(report.recommendation.recommendedAt.toISOString(), '2026-07-15T11:45:00.000Z');
  assert.ok(report.recommendation.estimatedResetValuePercent > 10);
});

test('skips an expiring reset when it has no projected recovery value', () => {
  const data = {
    credits: [{
      status: 'available',
      title: 'Full reset',
      expires_at: '2026-07-15T12:00:00Z',
    }],
    usage: {
      rate_limit: {
        primary_window: {
          used_percent: 0,
          limit_window_seconds: 604_800,
          reset_at: Date.parse('2026-07-20T00:00:00Z') / 1000,
        },
      },
    },
  };
  const report = normalizeReport(data, { now, timeZone: 'UTC' });
  assert.equal(report.recommendation.action, 'SKIP_EXPIRING_RESET');
  assert.equal(report.recommendation.recommendedAt, null);
  assert.equal(report.recommendation.estimatedResetValuePercent, 0);
});

test('projects higher daytime usage and lower overnight usage in the selected time zone', () => {
  const checkedAt = new Date('2026-07-14T02:00:00Z');
  const data = {
    credits: [{
      status: 'available',
      title: 'Full reset',
      expires_at: '2026-07-14T08:00:00Z',
    }],
    usage: {
      rate_limit: {
        primary_window: {
          used_percent: 20,
          limit_window_seconds: 604_800,
          reset_at: Date.parse('2026-07-20T02:00:00Z') / 1000,
        },
      },
    },
  };
  const overnight = normalizeReport(data, { now: checkedAt, timeZone: 'UTC' });
  const eveningPeak = normalizeReport(data, {
    now: checkedAt,
    timeZone: 'America/Los_Angeles',
  });
  assert.equal(overnight.weeklyUsage.averagePercentPerDay, 20);
  assert.equal(eveningPeak.weeklyUsage.averagePercentPerDay, 20);
  assert.ok(
    eveningPeak.recommendation.estimatedResetValuePercent
      > overnight.recommendation.estimatedResetValuePercent,
  );
});

test('uses sanitized recorded deltas when history matches the current reset epoch', () => {
  const report = normalizeReport(fixture, {
    now,
    timeZone: 'UTC',
    history: [{
      checked_at: '2026-07-13T22:25:36.000Z',
      five_hour: {
        used_percent: 18,
        resets_at: '2026-07-14T03:00:00.000Z',
      },
      weekly: {
        used_percent: 10,
        resets_at: '2026-07-20T00:00:00.000Z',
      },
    }],
  });
  assert.equal(report.fiveHourUsage.paceSource, 'recorded_history');
  assert.equal(report.weeklyUsage.paceSource, 'recorded_history');
  assert.equal(report.weeklyUsage.historySampleCount, 2);
  assert.ok(report.weeklyUsage.averagePercentPerDay > 300);
  assert.equal(report.recommendation.constrainingWindow, 'weekly');
  assert.ok(report.recommendation.recommendedAt < new Date('2026-07-15T00:00:00Z'));
});

test('ignores history from a previous reset epoch', () => {
  const report = normalizeReport(fixture, {
    now,
    timeZone: 'UTC',
    history: [{
      checked_at: '2026-07-13T22:25:36.000Z',
      weekly: {
        used_percent: 90,
        resets_at: '2026-07-19T00:00:00.000Z',
      },
    }],
  });
  assert.equal(report.weeklyUsage.paceSource, 'window_average');
  assert.equal(report.weeklyUsage.historySampleCount, 0);
});

test('does not let a short zero-delta sample erase the window-average forecast', () => {
  const report = normalizeReport(fixture, {
    now,
    timeZone: 'UTC',
    history: [{
      checked_at: '2026-07-13T22:25:36.000Z',
      five_hour: {
        used_percent: 20,
        resets_at: '2026-07-14T03:00:30.000Z',
      },
      weekly: {
        used_percent: 20,
        resets_at: '2026-07-20T00:00:30.000Z',
      },
    }],
  });
  assert.equal(report.fiveHourUsage.paceSource, 'window_average');
  assert.equal(report.weeklyUsage.paceSource, 'window_average');
  assert.ok(report.weeklyUsage.averagePercentPerDay > 0);
});

test('waits for the weekly reset when saved capacity outlives the window', () => {
  const data = {
    credits: [{
      status: 'available',
      title: 'Full reset',
      expires_at: '2026-07-26T12:00:00Z',
    }],
    usage: {
      rate_limit: {
        primary_window: {
          used_percent: 10,
          limit_window_seconds: 604_800,
          reset_at: Date.parse('2026-07-20T00:00:00Z') / 1000,
        },
      },
    },
  };
  const report = normalizeReport(data, { now, timeZone: 'UTC' });
  assert.equal(report.recommendation.action, 'WAIT_FOR_WEEKLY_RESET');
  assert.equal(report.recommendation.projectionAt.toISOString(), '2026-07-20T00:00:00.000Z');
});

test('recommends an immediate full reset when the five-hour window reaches the target', () => {
  const data = structuredClone(fixture);
  data.usage.rate_limit.primary_window.used_percent = 95;
  const report = normalizeReport(data, { now, timeZone: 'UTC' });
  assert.equal(report.recommendation.action, 'USE_NOW');
  assert.equal(report.recommendation.recommendedAt.toISOString(), now.toISOString());
});

test('uses clear expiry urgency boundaries', () => {
  assert.equal(urgencyFor(Number.NaN), 'UNKNOWN');
  assert.equal(urgencyFor(60 * 60 * 1000), 'NOW');
  assert.equal(urgencyFor(60 * 60 * 1000 + 1), 'SOON');
  assert.equal(urgencyFor(6 * 60 * 60 * 1000 + 1), 'TODAY');
  assert.equal(urgencyFor(24 * 60 * 60 * 1000 + 1), 'LATER');
  assert.equal(formatDuration(3_661_000), '1h 1m');
});

test('terminal output neutralizes control and direction-changing characters', () => {
  const unsafe = {
    credits: [{
      status: 'available',
      id: 'unsafe_\u001b[31mBAD',
      title: 'Safe\u001b[31m\n\u202e title',
      expires_at: '2026-07-14T00:00:00Z',
    }],
  };
  const report = normalizeReport(unsafe, { now, timeZone: 'UTC' });
  const output = renderTable(report, { color: false, width: 72, showIds: true });
  assert.doesNotMatch(output, /\u001b|\u202e/);
  assert.match(output, /Safe title/);
});

test('table output leads with the decision and highlights chronological milestones', () => {
  const report = normalizeReport(fixture, { now, timeZone: 'UTC' });
  const output = renderTable(report, { color: false, width: 96 });
  assert.doesNotMatch(output, /example0000000/);
  assert.doesNotMatch(output, /total earned/i);
  assert.doesNotMatch(output, /█|░/);
  assert.match(output, /20% used/);
  assert.match(output, /DECISION/);
  assert.match(output, /USE A SAVED RESET IN 3d 17h 23m/);
  assert.match(output, /KEY MILESTONES/);
  assert.match(output, /USE SAVED RESET/);
  assert.match(output, /NEXT SAVED RESET EXPIRES/);
  assert.match(output, /WEEKLY CAPACITY RUNS OUT/);
  assert.match(output, /LIMIT STATUS/);
  assert.match(output, /AT RISK/);
  assert.match(output, /points\/hour/);
  assert.match(output, /day\/night weighted/);
  assert.match(output, /NEAR LIMIT/);
  assert.match(output, /EXPECTED RESET VALUE/);
  assert.match(output, /weekly 95 points/);
  assert.match(output, /SAVED RESETS/);
  assert.match(output, /3 AVAILABLE/);
  assert.match(output, /credit expires in 3d 21h 1m/);
});

test('every uncolored table line has the requested width', () => {
  const report = normalizeReport(fixture, { now, timeZone: 'UTC' });
  const output = renderTable(report, { color: false, width: 72 });
  for (const line of output.trimEnd().split('\n')) assert.equal([...line].length, 72, line);
});

test('JSON output is normalized and private by default', () => {
  const report = normalizeReport(fixture, { now, timeZone: 'UTC' });
  const privateOutput = JSON.parse(renderJson(report));
  assert.equal(privateOutput.methodology_version, 2);
  assert.equal(privateOutput.five_hour_usage.used_percent, 20);
  assert.equal(privateOutput.five_hour_usage.window_minutes, 300);
  assert.equal(privateOutput.five_hour_usage.pace_source, 'window_average');
  assert.equal(privateOutput.five_hour_usage.history_sample_count, 0);
  assert.equal(privateOutput.weekly_usage.used_percent, 20);
  assert.equal(privateOutput.weekly_usage.exhausts_before_reset, true);
  assert.equal(privateOutput.recommendation.action, 'USE_NEAR_LIMIT');
  assert.equal(privateOutput.recommendation.constraining_window, 'weekly');
  assert.equal(privateOutput.recommendation.estimated_reset_value_percent, 95);
  assert.equal(privateOutput.recommendation.estimated_reset_values.five_hour_percent, null);
  assert.equal(privateOutput.recommendation.estimated_reset_values.weekly_percent, 95);
  assert.equal(privateOutput.weekly_usage.usage_profile.daytime_local_hours, '08:00-22:00');
  assert.equal(privateOutput.next_saved_full_reset.expires_at, '2026-07-17T20:26:53.000Z');
  assert.equal(Object.hasOwn(privateOutput.next_saved_full_reset, 'id'), false);
  assert.equal(privateOutput.available_count, 3);
  assert.equal(Object.hasOwn(privateOutput.credits[0], 'id'), false);

  const diagnosticOutput = JSON.parse(renderJson(report, { showIds: true }));
  assert.equal(diagnosticOutput.next_saved_full_reset.id, 'RateLimitResetCredit_example00000001');
  assert.equal(diagnosticOutput.credits[0].id, 'RateLimitResetCredit_example00000001');
});

test('rejects invalid time zones and timestamps', () => {
  assert.throws(() => normalizeReport(fixture, { now, timeZone: 'Not/A_Time_Zone' }), /Unknown time zone/);
  assert.throws(() => normalizeReport(fixture, { now: new Date('invalid'), timeZone: 'UTC' }), /Invalid value/);
});
