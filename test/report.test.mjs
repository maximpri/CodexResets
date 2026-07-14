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
      title: 'Safe\u001b[31m\n\u202e title',
      expires_at: '2026-07-14T00:00:00Z',
    }],
  };
  const report = normalizeReport(unsafe, { now, timeZone: 'UTC' });
  const output = renderTable(report, { color: false, width: 72 });
  assert.doesNotMatch(output, /\u001b|\u202e/);
  assert.match(output, /Safe title/);
});

test('table output hides identifiers and avoids invented percentages', () => {
  const report = normalizeReport(fixture, { now, timeZone: 'UTC' });
  const output = renderTable(report, { color: false, width: 96 });
  assert.doesNotMatch(output, /example0000000/);
  assert.doesNotMatch(output, /total earned/i);
  assert.doesNotMatch(output, /%|█|░/);
  assert.match(output, /3 available credits/);
  assert.match(output, /in 3d 21h 1m/);
});

test('every uncolored table line has the requested width', () => {
  const report = normalizeReport(fixture, { now, timeZone: 'UTC' });
  const output = renderTable(report, { color: false, width: 72 });
  for (const line of output.trimEnd().split('\n')) assert.equal([...line].length, 72, line);
});

test('JSON output is normalized and private by default', () => {
  const report = normalizeReport(fixture, { now, timeZone: 'UTC' });
  const privateOutput = JSON.parse(renderJson(report));
  assert.equal(privateOutput.available_count, 3);
  assert.equal(Object.hasOwn(privateOutput.credits[0], 'id'), false);

  const diagnosticOutput = JSON.parse(renderJson(report, { showIds: true }));
  assert.equal(diagnosticOutput.credits[0].id, 'RateLimitResetCredit_example00000001');
});

test('rejects invalid time zones and timestamps', () => {
  assert.throws(() => normalizeReport(fixture, { now, timeZone: 'Not/A_Time_Zone' }), /Unknown time zone/);
  assert.throws(() => normalizeReport(fixture, { now: new Date('invalid'), timeZone: 'UTC' }), /Invalid value/);
});
