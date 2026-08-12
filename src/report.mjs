const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const FIVE_HOURS = 5 * HOUR;
const WEEK = 7 * DAY;
const RESET_TARGET_PERCENT = 95;
const EXPIRY_BUFFER = 15 * MINUTE;
const DAYTIME_START_HOUR = 8;
const DAYTIME_END_HOUR = 22;
const DAYTIME_USAGE_WEIGHT = 1.25;
const NIGHT_USAGE_WEIGHT = 0.65;
const METHODOLOGY_VERSION = 3;

const ANSI = {
  reset: '\u001b[0m',
  bold: '\u001b[1m',
  dim: '\u001b[2m',
  red: '\u001b[31m',
  yellow: '\u001b[33m',
  cyan: '\u001b[36m',
  green: '\u001b[32m',
};

const stripAnsi = (value) => String(value).replace(/\u001b\[[0-9;]*m/g, '');
const visibleLength = (value) => [...stripAnsi(value)].length;
const clamp = (value, minimum, maximum) => Math.min(maximum, Math.max(minimum, value));

function finiteNumber(value) {
  const number = typeof value === 'string' && value.trim() ? Number(value) : value;
  return Number.isFinite(number) ? number : null;
}

function timestampDate(value) {
  if (value instanceof Date) return Number.isFinite(value.getTime()) ? new Date(value) : null;
  const numeric = finiteNumber(value);
  const date = numeric === null
    ? new Date(value ?? '')
    : new Date(Math.abs(numeric) < 1_000_000_000_000 ? numeric * 1000 : numeric);
  return Number.isFinite(date.getTime()) ? date : null;
}

export function validateTimeZone(timeZone) {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone }).format();
    return timeZone;
  } catch {
    throw new Error(`Unknown time zone: ${timeZone}`);
  }
}

function dateParts(date, timeZone) {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
    weekday: 'short',
    timeZoneName: 'short',
  });
  return Object.fromEntries(formatter.formatToParts(date).map(({ type, value }) => [type, value]));
}

function usageWeightAt(date, timeZone) {
  const hour = Number(dateParts(date, timeZone).hour);
  return hour >= DAYTIME_START_HOUR && hour < DAYTIME_END_HOUR
    ? DAYTIME_USAGE_WEIGHT
    : NIGHT_USAGE_WEIGHT;
}

function millisecondsToNextLocalHour(date, timeZone) {
  const part = dateParts(date, timeZone);
  return (60 - Number(part.minute)) * MINUTE
    - Number(part.second) * 1000
    - date.getUTCMilliseconds();
}

function weightedDurationMs(start, end, timeZone) {
  if (!start || !end || end <= start) return 0;
  let cursor = start.getTime();
  let weighted = 0;
  while (cursor < end.getTime()) {
    const date = new Date(cursor);
    const segmentMs = Math.min(
      end.getTime() - cursor,
      millisecondsToNextLocalHour(date, timeZone),
    );
    weighted += segmentMs * usageWeightAt(date, timeZone);
    cursor += segmentMs;
  }
  return weighted;
}

function dateAfterWeightedDuration(start, weightedMs, end, timeZone) {
  if (!Number.isFinite(weightedMs) || weightedMs <= 0) return new Date(start);
  let cursor = start.getTime();
  let remaining = weightedMs;
  const endMs = end?.getTime() ?? Number.POSITIVE_INFINITY;
  while (cursor < endMs) {
    const date = new Date(cursor);
    const weight = usageWeightAt(date, timeZone);
    const segmentMs = Math.min(
      endMs - cursor,
      millisecondsToNextLocalHour(date, timeZone),
    );
    const weightedSegment = segmentMs * weight;
    if (remaining <= weightedSegment) return new Date(cursor + remaining / weight);
    remaining -= weightedSegment;
    cursor += segmentMs;
  }
  return null;
}

function formatDate(date, timeZone, { seconds = true, weekday = true } = {}) {
  const part = dateParts(date, timeZone);
  const prefix = weekday ? `${part.weekday} ` : '';
  const clock = seconds
    ? `${part.hour}:${part.minute}:${part.second}`
    : `${part.hour}:${part.minute}`;
  return `${prefix}${part.year}-${part.month}-${part.day} ${clock} ${part.timeZoneName}`;
}

export function formatDuration(milliseconds) {
  if (!Number.isFinite(milliseconds)) return 'unknown';
  if (milliseconds <= 0) return 'expired';

  const totalMinutes = Math.floor(milliseconds / 60_000);
  const days = Math.floor(totalMinutes / 1440);
  const hours = Math.floor((totalMinutes % 1440) / 60);
  const minutes = totalMinutes % 60;
  const parts = [];
  if (days) parts.push(`${days}d`);
  if (hours || days) parts.push(`${hours}h`);
  parts.push(`${minutes}m`);
  return parts.join(' ');
}

export function urgencyFor(milliseconds) {
  if (!Number.isFinite(milliseconds)) return 'UNKNOWN';
  if (milliseconds <= HOUR) return 'NOW';
  if (milliseconds <= 6 * HOUR) return 'SOON';
  if (milliseconds <= 24 * HOUR) return 'TODAY';
  return 'LATER';
}

function windowDurationMs(window) {
  const seconds = finiteNumber(window?.limit_window_seconds);
  if (seconds !== null && seconds > 0) return seconds * 1000;
  const minutes = finiteNumber(window?.window_minutes);
  if (minutes !== null && minutes > 0) return minutes * MINUTE;
  return null;
}

function historicalPaceFor(usageWindow, checkedAt, timeZone, snapshots) {
  const historyKey = usageWindow.name === 'five_hour' ? 'five_hour' : 'weekly';
  const currentResetMs = usageWindow.resetsAt.getTime();
  const points = (Array.isArray(snapshots) ? snapshots : [])
    .map((snapshot) => {
      const observedAt = timestampDate(snapshot?.checked_at);
      const window = snapshot?.[historyKey];
      const usedPercent = finiteNumber(window?.used_percent);
      const resetsAt = timestampDate(window?.resets_at);
      if (!observedAt || !resetsAt || usedPercent === null) return null;
      if (observedAt >= checkedAt || observedAt < usageWindow.startedAt) return null;
      if (Math.abs(resetsAt.getTime() - currentResetMs) > MINUTE) return null;
      return { observedAt, usedPercent: clamp(usedPercent, 0, 100) };
    })
    .filter(Boolean)
    .sort((a, b) => a.observedAt - b.observedAt);
  points.push({ observedAt: checkedAt, usedPercent: usageWindow.usedPercent });

  let segmentStart = 0;
  for (let index = 1; index < points.length; index += 1) {
    if (points[index].usedPercent < points[index - 1].usedPercent) segmentStart = index;
  }
  const segment = points.slice(segmentStart);
  if (segment.length < 2) return null;
  const first = segment[0];
  const last = segment.at(-1);
  const observedMs = last.observedAt - first.observedAt;
  if (observedMs < 15 * MINUTE || observedMs > usageWindow.windowMs) return null;
  const usedDelta = last.usedPercent - first.usedPercent;
  if (usedDelta === 0 && observedMs < usageWindow.windowMs / 2) return null;
  const weightedMs = weightedDurationMs(first.observedAt, last.observedAt, timeZone);
  if (weightedMs <= 0) return null;
  return {
    averagePercentPerDay: usedDelta / (weightedMs / DAY),
    sampleCount: segment.length,
    observedMs,
  };
}

function normalizeUsageWindow(data, checkedAt, timeZone, definition, snapshots) {
  const usage = data?.usage ?? data;
  const rateLimit = usage?.rate_limit ?? usage?.rateLimit;
  if (!rateLimit || typeof rateLimit !== 'object') return null;

  const candidates = [
    ['primary', rateLimit.primary_window ?? rateLimit.primary],
    ['secondary', rateLimit.secondary_window ?? rateLimit.secondary],
  ]
    .map(([kind, window]) => ({ kind, window, durationMs: windowDurationMs(window) }))
    .filter(({ window, durationMs }) => window && durationMs !== null)
    .filter(({ durationMs }) => (
      durationMs >= definition.minimumMs && durationMs <= definition.maximumMs
    ))
    .sort((a, b) => (
      Math.abs(a.durationMs - definition.targetMs)
      - Math.abs(b.durationMs - definition.targetMs)
    ));

  const candidate = candidates[0];
  if (!candidate) return null;

  const used = finiteNumber(candidate.window.used_percent);
  if (used === null) return null;
  const usedPercent = clamp(used, 0, 100);
  const remainingPercent = 100 - usedPercent;
  const resetAfterSeconds = finiteNumber(candidate.window.reset_after_seconds);
  let resetsAt = timestampDate(candidate.window.reset_at ?? candidate.window.resets_at);
  if ((!resetsAt || resetsAt.getTime() <= checkedAt.getTime())
    && resetAfterSeconds !== null && resetAfterSeconds > 0) {
    resetsAt = new Date(checkedAt.getTime() + resetAfterSeconds * 1000);
  }
  if (!resetsAt || resetsAt.getTime() <= checkedAt.getTime()) return null;

  const startedAt = new Date(resetsAt.getTime() - candidate.durationMs);
  const elapsedMs = checkedAt.getTime() - startedAt.getTime();
  const validElapsed = elapsedMs >= 15 * MINUTE
    && elapsedMs <= candidate.durationMs
    && resetsAt.getTime() > checkedAt.getTime();
  const weightedElapsedMs = validElapsed
    ? weightedDurationMs(startedAt, checkedAt, timeZone)
    : null;
  let averagePercentPerDay = validElapsed && usedPercent > 0
    ? usedPercent / (weightedElapsedMs / DAY)
    : null;
  let paceSource = averagePercentPerDay === null ? 'insufficient_data' : 'window_average';
  let historySampleCount = 0;
  let historyObservedMs = 0;
  const usageWindowIdentity = {
    name: definition.name,
    startedAt,
    resetsAt,
    windowMs: candidate.durationMs,
    usedPercent,
  };
  const historicalPace = historicalPaceFor(
    usageWindowIdentity,
    checkedAt,
    timeZone,
    snapshots,
  );
  if (historicalPace) {
    averagePercentPerDay = historicalPace.averagePercentPerDay;
    paceSource = 'recorded_history';
    historySampleCount = historicalPace.sampleCount;
    historyObservedMs = historicalPace.observedMs;
  }
  const estimatedExhaustionAt = usedPercent >= 100
    ? new Date(checkedAt)
    : averagePercentPerDay === null || averagePercentPerDay <= 0
      ? null
      : dateAfterWeightedDuration(
        checkedAt,
        remainingPercent / averagePercentPerDay * DAY,
        resetsAt,
        timeZone,
      );
  const weightedRemainingMs = weightedDurationMs(checkedAt, resetsAt, timeZone);
  const projectedUsedAtReset = averagePercentPerDay === null
    ? usedPercent
    : clamp(usedPercent + averagePercentPerDay * weightedRemainingMs / DAY, 0, 100);
  const confidence = paceSource === 'recorded_history'
    ? historySampleCount >= 4 && historyObservedMs >= candidate.durationMs / 4
      ? 'HIGH'
      : 'MEDIUM'
    : averagePercentPerDay === null
      || elapsedMs < candidate.durationMs * (6 * HOUR / WEEK)
      ? 'LOW'
      : elapsedMs < candidate.durationMs * (DAY / WEEK)
        ? 'MEDIUM'
        : 'HIGH';

  return {
    name: definition.name,
    label: definition.label,
    kind: candidate.kind,
    usedPercent,
    remainingPercent,
    windowMs: candidate.durationMs,
    startedAt,
    resetsAt,
    remainingMs: resetsAt.getTime() - checkedAt.getTime(),
    averagePercentPerDay,
    averagePercentPerHour: averagePercentPerDay === null
      ? null
      : averagePercentPerDay / 24,
    paceSource,
    historySampleCount,
    historyObservedMs,
    usageProfile: {
      dayStartHour: DAYTIME_START_HOUR,
      dayEndHour: DAYTIME_END_HOUR,
      dayWeight: DAYTIME_USAGE_WEIGHT,
      nightWeight: NIGHT_USAGE_WEIGHT,
    },
    estimatedExhaustionAt,
    projectedUsedAtReset,
    exhaustsBeforeReset: estimatedExhaustionAt !== null
      && estimatedExhaustionAt.getTime() < resetsAt.getTime(),
    confidence,
    limitReached: Boolean(rateLimit.limit_reached) || usedPercent >= 100,
  };
}

function normalizeUsageWindows(data, checkedAt, timeZone, snapshots) {
  return {
    fiveHourUsage: normalizeUsageWindow(data, checkedAt, timeZone, {
      name: 'five_hour',
      label: '5-hour',
      targetMs: FIVE_HOURS,
      minimumMs: 3 * HOUR,
      maximumMs: 7 * HOUR,
    }, snapshots),
    weeklyUsage: normalizeUsageWindow(data, checkedAt, timeZone, {
      name: 'weekly',
      label: 'Weekly',
      targetMs: WEEK,
      minimumMs: 5 * DAY,
      maximumMs: 9 * DAY,
    }, snapshots),
  };
}

function projectedUsageAt(usageWindow, checkedAt, target, timeZone) {
  if (!target) return null;
  if (usageWindow.averagePercentPerDay === null) return usageWindow.usedPercent;
  const weightedMs = weightedDurationMs(checkedAt, target, timeZone);
  return clamp(
    usageWindow.usedPercent + usageWindow.averagePercentPerDay * weightedMs / DAY,
    0,
    100,
  );
}

function targetAtFor(usageWindow, checkedAt, timeZone) {
  if (!usageWindow || usageWindow.averagePercentPerDay === null
    || usageWindow.averagePercentPerDay <= 0) return null;
  const targetAt = dateAfterWeightedDuration(
    checkedAt,
    (RESET_TARGET_PERCENT - usageWindow.usedPercent)
      / usageWindow.averagePercentPerDay * DAY,
    usageWindow.resetsAt,
    timeZone,
  );
  return targetAt && targetAt < usageWindow.resetsAt ? targetAt : null;
}

function resetValuesAt(fiveHourUsage, weeklyUsage, checkedAt, target, timeZone) {
  const valueAt = (usageWindow) => usageWindow && target <= usageWindow.resetsAt
    ? projectedUsageAt(usageWindow, checkedAt, target, timeZone)
    : null;
  return {
    fiveHourPercent: valueAt(fiveHourUsage),
    weeklyPercent: valueAt(weeklyUsage),
  };
}

function highestResetValue(values) {
  const candidates = [
    ['five_hour', values.fiveHourPercent],
    ['weekly', values.weeklyPercent],
  ].filter(([, value]) => value !== null);
  if (!candidates.length) return { window: null, value: null };
  const [window, value] = candidates.sort((a, b) => b[1] - a[1])[0];
  return { window, value };
}

function planningBoundaryFor(usageWindow, subscription) {
  if (subscription?.expiresAt && subscription.expiresAt < usageWindow.resetsAt) {
    return { at: subscription.expiresAt, type: 'subscription_expiry' };
  }
  return { at: usageWindow.resetsAt, type: 'natural_reset' };
}

function exhaustsBeforePlanningBoundary(usageWindow, subscription) {
  if (!usageWindow?.estimatedExhaustionAt) return false;
  return usageWindow.estimatedExhaustionAt < planningBoundaryFor(
    usageWindow,
    subscription,
  ).at;
}

function normalizeSubscription(data, checkedAt) {
  const candidate = data?.subscription?.subscription ?? data?.subscription;
  if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) return null;

  const planType = String(candidate.plan_type ?? candidate.planType ?? '').trim() || null;
  const willRenewValue = candidate.will_renew ?? candidate.willRenew;
  const willRenew = typeof willRenewValue === 'boolean' ? willRenewValue : null;
  const activeUntil = timestampDate(
    candidate.active_until
      ?? candidate.activeUntil
      ?? candidate.current_period_end
      ?? candidate.currentPeriodEnd,
  );
  const explicitExpiry = timestampDate(
    candidate.expires_at
      ?? candidate.expiresAt
      ?? candidate.expiry_at
      ?? candidate.expiryAt,
  );
  const expiresAt = explicitExpiry ?? (willRenew === false ? activeUntil : null);
  const renewsAt = willRenew === true ? activeUntil : null;
  if (!planType && willRenew === null && !activeUntil && !explicitExpiry) return null;

  return {
    planType,
    willRenew,
    activeUntil,
    expiresAt,
    renewsAt,
    remainingMs: expiresAt ? expiresAt.getTime() - checkedAt.getTime() : Number.NaN,
  };
}

function buildRecommendation(
  fiveHourUsage,
  weeklyUsage,
  credits,
  subscription,
  checkedAt,
  timeZone,
) {
  const usableCredits = credits.filter((credit) => !credit.expiresAt || credit.remainingMs > 0);
  const nextSavedReset = usableCredits.find((credit) => credit.expiresAt) ?? usableCredits[0] ?? null;
  const usageWindows = [fiveHourUsage, weeklyUsage].filter(Boolean);
  const planningUsage = weeklyUsage ?? fiveHourUsage;
  const deadlines = [
    nextSavedReset?.expiresAt
      ? { at: nextSavedReset.expiresAt, type: 'banked_reset_expiry' }
      : null,
    subscription?.expiresAt
      ? { at: subscription.expiresAt, type: 'subscription_expiry' }
      : null,
  ].filter(Boolean).sort((left, right) => left.at - right.at);
  const decisionDeadline = deadlines[0] ?? null;
  const base = {
    targetPercent: RESET_TARGET_PERCENT,
    constrainingWindow: null,
    recommendedAt: null,
    projectionAt: null,
    deadlineAt: decisionDeadline?.at ?? null,
    deadlineType: decisionDeadline?.type ?? null,
    projectedUsagePercent: null,
    estimatedResetValuePercent: null,
    estimatedResetValues: {
      fiveHourPercent: null,
      weeklyPercent: null,
    },
  };

  if (subscription?.expiresAt && subscription.expiresAt <= checkedAt) {
    return {
      nextSavedReset,
      recommendation: {
        ...base,
        action: 'SUBSCRIPTION_EXPIRED',
        reason: 'The subscription has expired, so a banked reset should not be scheduled or redeemed.',
      },
    };
  }

  if (!usageWindows.length) {
    return {
      nextSavedReset,
      recommendation: {
        ...base,
        action: usableCredits.length ? 'CHECK_USAGE' : 'NO_SAVED_RESET',
        reason: 'Five-hour and weekly usage data are unavailable, so reset timing cannot be estimated.',
      },
    };
  }

  if (!usableCredits.length) {
    const exhaustion = usageWindows
      .filter((usageWindow) => exhaustsBeforePlanningBoundary(usageWindow, subscription))
      .sort((a, b) => a.estimatedExhaustionAt - b.estimatedExhaustionAt)[0];
    const subscriptionEndsFirst = subscription?.expiresAt
      && usageWindows.some((usageWindow) => (
        planningBoundaryFor(usageWindow, subscription).type === 'subscription_expiry'
      ));
    return {
      nextSavedReset: null,
      recommendation: {
        ...base,
        action: 'NO_SAVED_RESET',
        constrainingWindow: exhaustion?.name ?? (subscriptionEndsFirst ? planningUsage.name : null),
        reason: exhaustion
          ? `${exhaustion.label} usage is projected to run out before its reset, but no banked reset is available.`
          : subscriptionEndsFirst
            ? 'Subscription access ends before the active usage window reaches its next natural reset, and no banked reset is available.'
          : 'The active usage windows are expected to reset before current usage runs out.',
      },
    };
  }

  const atLimit = usageWindows
    .filter((usageWindow) => (
      usageWindow.limitReached || usageWindow.usedPercent >= RESET_TARGET_PERCENT
    ))
    .sort((a, b) => b.usedPercent - a.usedPercent)[0];
  if (atLimit) {
    const estimatedResetValues = resetValuesAt(
      fiveHourUsage,
      weeklyUsage,
      checkedAt,
      checkedAt,
      timeZone,
    );
    return {
      nextSavedReset,
      recommendation: {
        ...base,
        action: 'USE_NOW',
        constrainingWindow: atLimit.name,
        recommendedAt: new Date(checkedAt),
        projectionAt: new Date(checkedAt),
        projectedUsagePercent: atLimit.usedPercent,
        estimatedResetValuePercent: atLimit.usedPercent,
        estimatedResetValues,
        reason: `${atLimit.label} usage is already at or above ${RESET_TARGET_PERCENT}%.`,
      },
    };
  }

  const targetCandidate = usageWindows
    .map((usageWindow) => ({
      usageWindow,
      targetAt: targetAtFor(usageWindow, checkedAt, timeZone),
    }))
    .filter(({ targetAt }) => targetAt)
    .sort((a, b) => a.targetAt - b.targetAt)[0] ?? null;
  const latestUseAt = decisionDeadline?.at
    ? new Date(Math.max(
      checkedAt.getTime(),
      decisionDeadline.at.getTime() - EXPIRY_BUFFER,
    ))
    : null;
  const deadlineBeforeTarget = latestUseAt
    && (!targetCandidate || latestUseAt < targetCandidate.targetAt);
  const deadlineBeforePlanningReset = decisionDeadline?.at
    && decisionDeadline.at < planningUsage.resetsAt;

  if (targetCandidate && !deadlineBeforeTarget) {
    const estimatedResetValues = resetValuesAt(
      fiveHourUsage,
      weeklyUsage,
      checkedAt,
      targetCandidate.targetAt,
      timeZone,
    );
    return {
      nextSavedReset,
      recommendation: {
        ...base,
        action: 'USE_NEAR_LIMIT',
        constrainingWindow: targetCandidate.usageWindow.name,
        recommendedAt: targetCandidate.targetAt,
        projectionAt: targetCandidate.targetAt,
        projectedUsagePercent: RESET_TARGET_PERCENT,
        estimatedResetValuePercent: RESET_TARGET_PERCENT,
        estimatedResetValues,
        reason: `${targetCandidate.usageWindow.label} usage reaches the near-limit target before its natural reset.`,
      },
    };
  }

  if (deadlineBeforeTarget && deadlineBeforePlanningReset) {
    const estimatedResetValues = resetValuesAt(
      fiveHourUsage,
      weeklyUsage,
      checkedAt,
      latestUseAt,
      timeZone,
    );
    const { window: valueWindow, value: estimatedResetValuePercent } = highestResetValue(
      estimatedResetValues,
    );
    if (estimatedResetValuePercent <= 0) {
      return {
        nextSavedReset,
        recommendation: {
          ...base,
          action: 'SKIP_EXPIRING_RESET',
          constrainingWindow: valueWindow,
          projectionAt: latestUseAt,
          projectedUsagePercent: estimatedResetValuePercent,
          estimatedResetValuePercent,
          estimatedResetValues,
          reason: decisionDeadline.type === 'subscription_expiry'
            ? 'The banked reset has no projected recovery value before the subscription expires.'
            : 'The next banked reset has no projected recovery value before it expires.',
        },
      };
    }
    return {
      nextSavedReset,
      recommendation: {
        ...base,
        action: 'USE_BEFORE_EXPIRY',
        constrainingWindow: valueWindow,
        recommendedAt: latestUseAt,
        projectionAt: latestUseAt,
        projectedUsagePercent: estimatedResetValuePercent,
        estimatedResetValuePercent,
        estimatedResetValues,
        reason: decisionDeadline.type === 'subscription_expiry'
          ? 'Use the banked reset before the subscription expires to recover its projected value while it is still usable.'
          : 'Use the next banked reset near expiry to recover its projected value before it is lost.',
      },
    };
  }

  return {
    nextSavedReset,
    recommendation: {
      ...base,
      action: weeklyUsage ? 'WAIT_FOR_WEEKLY_RESET' : 'WAIT_FOR_FIVE_HOUR_RESET',
      constrainingWindow: planningUsage.name,
      projectionAt: planningUsage.resetsAt,
      projectedUsagePercent: planningUsage.projectedUsedAtReset,
      reason: planningUsage.averagePercentPerDay === null
        ? 'There is not enough usage yet for a reliable pace estimate, and the banked reset outlives this window.'
        : 'The active usage windows are expected to reset before reaching the near-limit target.',
    },
  };
}

function creditId(credit) {
  return String(credit?.id ?? credit?.credit_id ?? '');
}

export function normalizeReport(data, { now = new Date(), timeZone, history = [] } = {}) {
  validateTimeZone(timeZone);
  const checkedAt = new Date(now);
  if (!Number.isFinite(checkedAt.getTime())) throw new Error('Invalid value for --now.');

  const credits = (Array.isArray(data?.credits) ? data.credits : [])
    .filter((credit) => String(credit?.status || '').toLowerCase() === 'available')
    .map((credit) => {
      const expiresAt = new Date(credit?.expires_at ?? credit?.expiresAt ?? '');
      const validExpiry = Number.isFinite(expiresAt.getTime());
      const remainingMs = validExpiry ? expiresAt.getTime() - checkedAt.getTime() : Number.NaN;
      return {
        id: creditId(credit),
        title: String(credit?.title || credit?.name || 'Reset credit'),
        expiresAt: validExpiry ? expiresAt : null,
        remainingMs,
        urgency: urgencyFor(remainingMs),
      };
    })
    .sort((a, b) => {
      if (!a.expiresAt) return 1;
      if (!b.expiresAt) return -1;
      return a.expiresAt - b.expiresAt;
    });

  const { fiveHourUsage, weeklyUsage } = normalizeUsageWindows(
    data,
    checkedAt,
    timeZone,
    history,
  );
  const subscription = normalizeSubscription(data, checkedAt);
  const { nextSavedReset, recommendation } = buildRecommendation(
    fiveHourUsage,
    weeklyUsage,
    credits,
    subscription,
    checkedAt,
    timeZone,
  );
  return {
    checkedAt,
    timeZone,
    fiveHourUsage,
    weeklyUsage,
    subscription,
    nextSavedReset,
    recommendation,
    credits,
  };
}

function truncate(value, maximum) {
  const text = String(value);
  if ([...text].length <= maximum) return text;
  return `${[...text].slice(0, Math.max(0, maximum - 1)).join('')}…`;
}

function terminalSafe(value) {
  return String(value)
    .replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, '')
    .replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ')
    .replace(/[\u202a-\u202e\u2066-\u2069]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function idLabel(id) {
  const safeId = terminalSafe(id);
  if (!safeId) return 'ID unavailable';
  const tail = safeId.includes('_') ? safeId.slice(safeId.lastIndexOf('_') + 1) : safeId;
  return `ID …${tail.slice(-8)}`;
}

function usageWindowJson(usage, paceUnit, subscription) {
  if (!usage) return null;
  const planningBoundary = planningBoundaryFor(usage, subscription);
  return {
    used_percent: usage.usedPercent,
    remaining_percent: usage.remainingPercent,
    window_minutes: usage.windowMs / MINUTE,
    started_at: usage.startedAt.toISOString(),
    resets_at: usage.resetsAt.toISOString(),
    resets_in: formatDuration(usage.remainingMs),
    ...(paceUnit === 'hour' ? {
      average_percent_per_hour: usage.averagePercentPerHour === null
        ? null
        : Number(usage.averagePercentPerHour.toFixed(2)),
    } : {
      average_percent_per_day: usage.averagePercentPerDay === null
        ? null
        : Number(usage.averagePercentPerDay.toFixed(2)),
    }),
    estimated_exhaustion_at: usage.estimatedExhaustionAt?.toISOString() ?? null,
    exhausts_before_reset: usage.exhaustsBeforeReset,
    planning_boundary_at: planningBoundary.at.toISOString(),
    planning_boundary_type: planningBoundary.type,
    exhausts_before_planning_boundary: exhaustsBeforePlanningBoundary(usage, subscription),
    projected_used_percent_at_reset: Number(usage.projectedUsedAtReset.toFixed(2)),
    projection_confidence: usage.confidence,
    pace_source: usage.paceSource,
    history_sample_count: usage.historySampleCount,
    usage_profile: {
      daytime_local_hours: `${String(usage.usageProfile.dayStartHour).padStart(2, '0')}:00-${String(usage.usageProfile.dayEndHour).padStart(2, '0')}:00`,
      daytime_weight: usage.usageProfile.dayWeight,
      night_weight: usage.usageProfile.nightWeight,
    },
  };
}

export function renderJson(report, { showIds = false } = {}) {
  const recommendation = report.recommendation;
  const output = {
    methodology_version: METHODOLOGY_VERSION,
    checked_at: report.checkedAt.toISOString(),
    time_zone: report.timeZone,
    subscription: report.subscription ? {
      plan_type: report.subscription.planType,
      will_renew: report.subscription.willRenew,
      active_until: report.subscription.activeUntil?.toISOString() ?? null,
      renews_at: report.subscription.renewsAt?.toISOString() ?? null,
      expires_at: report.subscription.expiresAt?.toISOString() ?? null,
      expires_in: report.subscription.expiresAt
        ? formatDuration(report.subscription.remainingMs)
        : null,
    } : null,
    five_hour_usage: usageWindowJson(report.fiveHourUsage, 'hour', report.subscription),
    weekly_usage: usageWindowJson(report.weeklyUsage, 'day', report.subscription),
    recommendation: {
      action: recommendation.action,
      target_percent: recommendation.targetPercent,
      constraining_window: recommendation.constrainingWindow,
      recommended_at: recommendation.recommendedAt?.toISOString() ?? null,
      projection_at: recommendation.projectionAt?.toISOString() ?? null,
      deadline_at: recommendation.deadlineAt?.toISOString() ?? null,
      deadline_type: recommendation.deadlineType,
      projected_usage_percent: recommendation.projectedUsagePercent === null
        ? null
        : Number(recommendation.projectedUsagePercent.toFixed(2)),
      estimated_reset_value_percent: recommendation.estimatedResetValuePercent === null
        ? null
        : Number(recommendation.estimatedResetValuePercent.toFixed(2)),
      estimated_reset_values: {
        five_hour_percent: recommendation.estimatedResetValues.fiveHourPercent === null
          ? null
          : Number(recommendation.estimatedResetValues.fiveHourPercent.toFixed(2)),
        weekly_percent: recommendation.estimatedResetValues.weeklyPercent === null
          ? null
          : Number(recommendation.estimatedResetValues.weeklyPercent.toFixed(2)),
      },
      reason: recommendation.reason,
    },
    next_saved_full_reset: report.nextSavedReset ? {
      title: report.nextSavedReset.title,
      expires_at: report.nextSavedReset.expiresAt?.toISOString() ?? null,
      expires_in: formatDuration(report.nextSavedReset.remainingMs),
      ...(showIds ? { id: report.nextSavedReset.id || null } : {}),
    } : null,
    available_count: report.credits.length,
    credits: report.credits.map((credit) => ({
      title: credit.title,
      expires_at: credit.expiresAt?.toISOString() ?? null,
      time_left: formatDuration(credit.remainingMs),
      urgency: credit.urgency,
      ...(showIds ? { id: credit.id || null } : {}),
    })),
  };
  return `${JSON.stringify(output, null, 2)}\n`;
}

function formatFriendlyDate(date, timeZone) {
  if (!date || !Number.isFinite(date.getTime())) return 'an unknown time';
  return new Intl.DateTimeFormat('en-US', {
    timeZone,
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
    timeZoneName: 'short',
  }).format(date);
}

function compactUsageState(usage, subscription) {
  if (!usage) return null;
  if (exhaustsBeforePlanningBoundary(usage, subscription)) {
    return { label: 'AT RISK', style: 'red' };
  }
  if (usage.averagePercentPerDay === null) return { label: 'LEARNING', style: 'dim' };
  return { label: 'ON TRACK', style: 'green' };
}

function recommendationUsage(report) {
  return report.recommendation.constrainingWindow === 'five_hour'
    ? report.fiveHourUsage
    : report.recommendation.constrainingWindow === 'weekly'
      ? report.weeklyUsage
      : report.weeklyUsage ?? report.fiveHourUsage;
}

function compactResetValue(recommendation) {
  const values = recommendation.estimatedResetValues ?? {};
  const labels = [
    values.fiveHourPercent === null || values.fiveHourPercent === undefined
      ? null
      : `${Number(values.fiveHourPercent.toFixed(1))} five-hour points`,
    values.weeklyPercent === null || values.weeklyPercent === undefined
      ? null
      : `${Number(values.weeklyPercent.toFixed(1))} weekly points`,
  ].filter(Boolean);
  return labels.join(' and ');
}

function compactDecision(report) {
  const recommendation = report.recommendation;
  const usage = recommendationUsage(report);
  const confidence = usage?.confidence ?? 'LOW';
  const recommendedAt = recommendation.recommendedAt;
  const future = recommendedAt && recommendedAt > report.checkedAt;
  const when = recommendedAt
    ? formatFriendlyDate(recommendedAt, report.timeZone)
    : null;

  if (['USE_NEAR_LIMIT', 'USE_BEFORE_EXPIRY'].includes(recommendation.action) && future) {
    if (confidence === 'LOW') {
      return {
        title: 'NO ACTION NOW',
        style: 'green',
        next: `Recheck closer to ${when}; this forecast is low confidence.`,
      };
    }
    return {
      title: 'PLAN TO RECHECK',
      style: 'yellow',
      next: recommendation.action === 'USE_BEFORE_EXPIRY'
        ? recommendation.deadlineType === 'subscription_expiry'
          ? `Recheck near ${when}; redeem only if the reset value is worthwhile before the subscription ends.`
          : `Recheck near ${when}; redeem only if the reset value is still worthwhile.`
        : `Recheck near ${when}; redeem only if usage is still near its limit.`,
    };
  }

  if (['USE_NOW', 'USE_NEAR_LIMIT', 'USE_BEFORE_EXPIRY'].includes(recommendation.action)) {
    const value = compactResetValue(recommendation);
    return {
      title: 'BANKED RESET READY',
      style: 'yellow',
      next: value
        ? `Redeem now only if restoring about ${value} is useful to you.`
        : 'Redeem now only if restoring the eligible usage window is useful to you.',
    };
  }

  if (['WAIT_FOR_WEEKLY_RESET', 'WAIT_FOR_FIVE_HOUR_RESET'].includes(recommendation.action)) {
    const window = recommendation.action === 'WAIT_FOR_WEEKLY_RESET' ? 'weekly' : 'five-hour';
    return {
      title: 'NO ACTION NOW',
      style: 'green',
      next: `Let the ${window} limit reset naturally before using a banked reset.`,
    };
  }

  if (recommendation.action === 'SKIP_EXPIRING_RESET') {
    return {
      title: 'NO ACTION NEEDED',
      style: 'green',
      next: recommendation.deadlineType === 'subscription_expiry'
        ? 'No useful recovery is expected before the subscription expires.'
        : 'No useful recovery is expected before this banked reset expires.',
    };
  }

  if (recommendation.action === 'SUBSCRIPTION_EXPIRED') {
    return {
      title: 'SUBSCRIPTION EXPIRED',
      style: 'red',
      next: 'Renew the subscription before planning or redeeming a banked reset.',
    };
  }

  if (recommendation.action === 'NO_SAVED_RESET') {
    return {
      title: 'NO BANKED RESET AVAILABLE',
      style: 'dim',
      next: report.subscription?.expiresAt
        ? `Subscription access ends ${formatFriendlyDate(report.subscription.expiresAt, report.timeZone)}; no banked reset is available.`
        : 'Continue using Codex; there is no banked reset to manage.',
    };
  }

  return {
    title: 'CHECK USAGE',
    style: 'cyan',
    next: 'Usage data is incomplete; check again before deciding.',
  };
}

function renderCompactTable(report, options = {}) {
  const color = Boolean(options.color);
  const ascii = Boolean(options.ascii);
  const requestedWidth = Number(options.width);
  const width = Math.min(120, Math.max(40, Number.isFinite(requestedWidth) ? requestedWidth : 96));
  const framed = width >= 68;
  const contentWidth = framed ? width - 4 : width;
  const glyph = ascii
    ? { tl: '+', tr: '+', bl: '+', br: '+', h: '-', v: '|', ml: '+', mr: '+', bullet: '*' }
    : { tl: '╭', tr: '╮', bl: '╰', br: '╯', h: '─', v: '│', ml: '├', mr: '┤', bullet: '•' };
  const paint = (value, ...styles) => color
    ? `${styles.map((style) => ANSI[style]).join('')}${value}${ANSI.reset}`
    : String(value);
  const line = (content = '') => {
    if (!framed) return content;
    const padding = Math.max(0, contentWidth - visibleLength(content));
    return `${glyph.v} ${content}${' '.repeat(padding)} ${glyph.v}`;
  };
  const border = (left, right) => `${left}${glyph.h.repeat(width - 2)}${right}`;
  const separator = () => framed ? border(glyph.ml, glyph.mr) : '';
  const output = [];
  const pushLine = (content = '') => output.push(line(content));
  const wrap = (value, firstPrefix = '', restPrefix = ' '.repeat(visibleLength(firstPrefix))) => {
    const words = terminalSafe(value).split(' ').filter(Boolean);
    const rows = [];
    let prefix = firstPrefix;
    let current = '';
    for (const word of words) {
      const maximum = Math.max(1, contentWidth - visibleLength(prefix));
      if (!current) {
        current = truncate(word, maximum);
      } else if (visibleLength(`${current} ${word}`) <= maximum) {
        current = `${current} ${word}`;
      } else {
        rows.push(`${prefix}${current}`);
        prefix = restPrefix;
        current = truncate(word, Math.max(1, contentWidth - visibleLength(prefix)));
      }
    }
    rows.push(`${prefix}${current}`);
    return rows;
  };
  const pushWrapped = (value, firstPrefix = '', restPrefix, ...styles) => {
    for (const row of wrap(value, firstPrefix, restPrefix)) pushLine(paint(row, ...styles));
  };
  const labelPrefix = (label) => `${label.padEnd(9)} `;
  const continuationPrefix = ' '.repeat(10);
  const numberLabel = (value) => Number.isInteger(value)
    ? String(value)
    : value.toFixed(1).replace(/\.0$/, '');

  if (framed) output.push(border(glyph.tl, glyph.tr));
  const checked = `checked ${formatFriendlyDate(report.checkedAt, report.timeZone)}`;
  const brand = 'CODEXRESETS';
  if (visibleLength(brand) + visibleLength(checked) + 1 <= contentWidth) {
    const gap = ' '.repeat(contentWidth - visibleLength(brand) - visibleLength(checked));
    pushLine(`${paint(brand, 'bold')}${gap}${paint(checked, 'dim')}`);
  } else {
    pushLine(paint(brand, 'bold'));
    pushWrapped(checked, '', '', 'dim');
  }
  if (framed) output.push(separator());
  else pushLine();

  const decision = compactDecision(report);
  pushLine(paint(decision.title, 'bold', decision.style));
  pushWrapped(decision.next, labelPrefix('Next'), continuationPrefix);
  pushLine();

  const appendUsage = (usage) => {
    if (!usage) return;
    const state = compactUsageState(usage, report.subscription);
    pushWrapped(
      `${numberLabel(usage.usedPercent)}% used ${glyph.bullet} ${numberLabel(usage.remainingPercent)}% left`,
      labelPrefix(usage.label),
      continuationPrefix,
      'bold',
    );
    pushWrapped(
      `resets ${formatFriendlyDate(usage.resetsAt, report.timeZone)} (${formatDuration(usage.remainingMs)}) ${glyph.bullet} ${state.label}`,
      continuationPrefix,
      continuationPrefix,
      state.style,
    );
  };
  appendUsage(report.weeklyUsage);
  appendUsage(report.fiveHourUsage);
  if (!report.weeklyUsage && !report.fiveHourUsage) {
    pushWrapped('Usage data is unavailable in this response.', labelPrefix('Usage'), continuationPrefix, 'dim');
  }

  if (report.subscription) {
    const plan = report.subscription.planType ? `${terminalSafe(report.subscription.planType)} ` : '';
    const status = report.subscription.expiresAt
      ? report.subscription.remainingMs <= 0
        ? `expired ${formatFriendlyDate(report.subscription.expiresAt, report.timeZone)}`
        : `expires ${formatFriendlyDate(report.subscription.expiresAt, report.timeZone)} (${formatDuration(report.subscription.remainingMs)})`
      : report.subscription.renewsAt
        ? `renews ${formatFriendlyDate(report.subscription.renewsAt, report.timeZone)}`
        : report.subscription.activeUntil
          ? `period ends ${formatFriendlyDate(report.subscription.activeUntil, report.timeZone)} ${glyph.bullet} renewal unknown`
          : 'expiry unavailable';
    pushWrapped(
      `${plan}${status}`,
      labelPrefix('Plan'),
      continuationPrefix,
      report.subscription.expiresAt ? 'yellow' : 'dim',
    );
  }

  const forecastUsage = recommendationUsage(report);
  if (exhaustsBeforePlanningBoundary(forecastUsage, report.subscription)) {
    pushWrapped(
      `${forecastUsage.label} capacity may run out ${formatFriendlyDate(forecastUsage.estimatedExhaustionAt, report.timeZone)} ${glyph.bullet} ${forecastUsage.confidence}`,
      labelPrefix('Forecast'),
      continuationPrefix,
      forecastUsage.confidence === 'LOW' ? 'dim' : 'yellow',
    );
  }

  if (report.nextSavedReset) {
    const available = `${report.credits.length} available`;
    const expiry = report.nextSavedReset.expiresAt
      ? `expires ${formatFriendlyDate(report.nextSavedReset.expiresAt, report.timeZone)}`
      : 'expiry unknown';
    pushWrapped(
      `${expiry} ${glyph.bullet} ${available}`,
      labelPrefix('Banked'),
      continuationPrefix,
      report.nextSavedReset.urgency === 'NOW' ? 'red' : 'yellow',
    );
  } else {
    pushWrapped('none available', labelPrefix('Banked'), continuationPrefix, 'dim');
  }

  if (framed) output.push(separator());
  else pushLine();
  if (!framed && !options.brief) {
    pushWrapped(
      'Widen the terminal to 68 columns for the full report, or use --format json.',
      labelPrefix('Full'),
      continuationPrefix,
      'dim',
    );
  } else {
    pushWrapped('rerun without --brief', labelPrefix('Full'), continuationPrefix, 'dim');
  }
  const lowConfidence = [report.weeklyUsage, report.fiveHourUsage]
    .filter(Boolean)
    .some((usage) => usage.confidence === 'LOW');
  if (lowConfidence && !options.input && !options.record) {
    pushWrapped('codexresets --record', labelPrefix('Improve'), continuationPrefix, 'dim');
  }
  if (framed) output.push(border(glyph.bl, glyph.br));
  return `${output.join('\n')}\n`;
}

function renderDetailedTable(report, options = {}) {
  const color = Boolean(options.color);
  const ascii = Boolean(options.ascii);
  const showIds = Boolean(options.showIds);
  const requestedWidth = Number(options.width);
  const width = Math.min(120, Math.max(68, Number.isFinite(requestedWidth) ? requestedWidth : 96));
  const inner = width - 4;
  const glyph = ascii
    ? {
      tl: '+', tr: '+', bl: '+', br: '+', h: '-', v: '|', ml: '+', mr: '+',
      dot: 'o', focus: '>', risk: '!', bullet: '*',
    }
    : {
      tl: '╭', tr: '╮', bl: '╰', br: '╯', h: '─', v: '│', ml: '├', mr: '┤',
      dot: '●', focus: '◆', risk: '!', bullet: '•',
    };

  const paint = (value, ...styles) => color
    ? `${styles.map((style) => ANSI[style]).join('')}${value}${ANSI.reset}`
    : String(value);
  const urgencyStyle = { NOW: 'red', SOON: 'yellow', TODAY: 'cyan', LATER: 'green', UNKNOWN: 'dim' };
  const actionStyle = {
    USE_NOW: 'red',
    USE_NEAR_LIMIT: 'yellow',
    USE_BEFORE_EXPIRY: 'yellow',
    WAIT_FOR_WEEKLY_RESET: 'green',
    WAIT_FOR_FIVE_HOUR_RESET: 'green',
    SKIP_EXPIRING_RESET: 'green',
    NO_SAVED_RESET: 'dim',
    CHECK_USAGE: 'cyan',
    SUBSCRIPTION_EXPIRED: 'red',
  };
  const actionLabel = {
    USE_NOW: 'USE NOW',
    USE_NEAR_LIMIT: 'NEAR LIMIT',
    USE_BEFORE_EXPIRY: 'BEFORE EXPIRY',
    WAIT_FOR_WEEKLY_RESET: 'WAIT',
    WAIT_FOR_FIVE_HOUR_RESET: 'WAIT',
    SKIP_EXPIRING_RESET: 'SKIP / WAIT',
    NO_SAVED_RESET: 'NO BANKED',
    CHECK_USAGE: 'CHECK USAGE',
    SUBSCRIPTION_EXPIRED: 'EXPIRED',
  };
  const actionHeadline = {
    USE_NOW: 'USE A BANKED RESET NOW',
    WAIT_FOR_WEEKLY_RESET: 'KEEP YOUR BANKED RESET',
    WAIT_FOR_FIVE_HOUR_RESET: 'KEEP YOUR BANKED RESET',
    SKIP_EXPIRING_RESET: 'LET THIS BANKED RESET EXPIRE',
    NO_SAVED_RESET: 'NO BANKED RESET TO USE',
    CHECK_USAGE: 'CHECK USAGE BEFORE DECIDING',
    SUBSCRIPTION_EXPIRED: 'RENEW YOUR SUBSCRIPTION',
  };
  const numberLabel = (value, decimals = 1) => Number.isInteger(value)
    ? String(value)
    : value.toFixed(decimals).replace(/\.0$/, '');
  const fit = (value, maximum) => truncate(value, maximum).padEnd(maximum);
  const line = (content = '') => {
    const padding = Math.max(0, inner - visibleLength(content));
    return `${glyph.v} ${content}${' '.repeat(padding)} ${glyph.v}`;
  };
  const sides = (left, right) => {
    const gap = Math.max(1, inner - visibleLength(left) - visibleLength(right));
    return line(`${left}${' '.repeat(gap)}${right}`);
  };
  const wrappedLines = (value, prefix = '', ...styles) => {
    const words = terminalSafe(value).split(' ').filter(Boolean);
    const maximum = Math.max(1, inner - visibleLength(prefix));
    const rows = [];
    let current = '';
    for (const word of words) {
      if (!current) {
        current = truncate(word, maximum);
      } else if (visibleLength(`${current} ${word}`) <= maximum) {
        current = `${current} ${word}`;
      } else {
        rows.push(current);
        current = truncate(word, maximum);
      }
    }
    if (current || !rows.length) rows.push(current);
    return rows.map((row, index) => line(paint(
      `${index === 0 ? prefix : ' '.repeat(visibleLength(prefix))}${row}`,
      ...styles,
    )));
  };
  const border = (left, right) => `${left}${glyph.h.repeat(width - 2)}${right}`;
  const separator = () => border(glyph.ml, glyph.mr);

  const output = [border(glyph.tl, glyph.tr)];
  const count = report.credits.length;
  output.push(sides(
    `${paint('CODEXRESETS', 'bold')} ${paint('/ RESET CONTROL', 'dim')}`,
    paint(`checked ${formatDate(report.checkedAt, report.timeZone, { seconds: false, weekday: false })}`, 'dim'),
  ));
  output.push(separator());
  const recommendation = report.recommendation;
  const recommendationRemaining = recommendation.recommendedAt
    ? recommendation.recommendedAt - report.checkedAt
    : null;
  const lowConfidenceFuture = ['USE_NEAR_LIMIT', 'USE_BEFORE_EXPIRY']
    .includes(recommendation.action)
    && recommendationRemaining > 0
    && recommendationUsage(report)?.confidence === 'LOW';
  const recommendationBadge = paint(
    lowConfidenceFuture
      ? 'LOW CONFIDENCE'
      : actionLabel[recommendation.action] ?? recommendation.action,
    'bold',
    lowConfidenceFuture ? 'cyan' : actionStyle[recommendation.action] ?? 'dim',
  );
  const dynamicHeadline = lowConfidenceFuture
    ? 'NO ACTION NOW — RECHECK CLOSER TO THIS DATE'
    : ['USE_NEAR_LIMIT', 'USE_BEFORE_EXPIRY'].includes(recommendation.action)
      ? recommendationRemaining <= 0
        ? 'USE A BANKED RESET NOW'
        : `USE A BANKED RESET IN ${formatDuration(recommendationRemaining)}`
      : actionHeadline[recommendation.action] ?? recommendation.action;
  output.push(sides(paint('DECISION', 'bold'), recommendationBadge));
  output.push(line(paint(
    dynamicHeadline,
    'bold',
    lowConfidenceFuture ? 'cyan' : actionStyle[recommendation.action] ?? 'dim',
  )));
  output.push(...wrappedLines(
    lowConfidenceFuture
      ? 'Current usage suggests a banked reset may become useful near the forecast date.'
      : recommendation.reason,
    `${glyph.bullet} `,
  ));
  if (lowConfidenceFuture) {
    output.push(...wrappedLines(
      'Treat this as a provisional forecast, not a scheduled redemption.',
      `${glyph.bullet} `,
      'dim',
    ));
  }
  if (recommendation.recommendedAt) {
    output.push(sides(
      paint(lowConfidenceFuture ? 'RECHECK NEAR' : 'DO THIS', 'dim'),
      paint(formatDate(recommendation.recommendedAt, report.timeZone, { seconds: false }), 'bold'),
    ));
  }
  const resetValues = recommendation.estimatedResetValues;
  const valueParts = [
    resetValues.fiveHourPercent === null
      ? null
      : `5-hour ${numberLabel(resetValues.fiveHourPercent)} points`,
    resetValues.weeklyPercent === null
      ? null
      : `weekly ${numberLabel(resetValues.weeklyPercent)} points`,
  ].filter(Boolean);
  if (valueParts.length) {
    output.push(sides(
      paint('EXPECTED RESET VALUE', 'dim'),
      paint(valueParts.join(` ${glyph.bullet} `), 'bold'),
    ));
  } else if (recommendation.estimatedResetValuePercent !== null) {
    output.push(sides(
      paint('EXPECTED RESET VALUE', 'dim'),
      paint(`${numberLabel(recommendation.estimatedResetValuePercent)} points`, 'bold'),
    ));
  } else if (recommendation.projectedUsagePercent !== null) {
    const projectionLabel = recommendation.action === 'WAIT_FOR_WEEKLY_RESET'
      ? 'AT WEEKLY RESET'
      : recommendation.action === 'WAIT_FOR_FIVE_HOUR_RESET'
        ? 'AT 5-HOUR RESET'
      : recommendation.action === 'SKIP_EXPIRING_RESET'
        ? recommendation.deadlineType === 'subscription_expiry'
          ? 'AT SUBSCRIPTION EXPIRY'
          : 'AT BANKED RESET EXPIRY'
        : 'PROJECTED USAGE';
    output.push(sides(
      paint(projectionLabel, 'dim'),
      paint(`${numberLabel(recommendation.projectedUsagePercent)}% used`, 'bold'),
    ));
  }
  if (report.nextSavedReset) {
    const expiry = recommendation.deadlineAt;
    const deadlineLabel = recommendation.deadlineType === 'subscription_expiry'
      ? 'subscription expires in'
      : 'banked reset expires in';
    output.push(sides(
      paint('DECISION DEADLINE', 'dim'),
      expiry
        ? expiry <= report.checkedAt
          ? paint(recommendation.deadlineType === 'subscription_expiry'
            ? 'subscription expired'
            : 'banked reset expired', 'red')
          : `${deadlineLabel} ${paint(formatDuration(expiry - report.checkedAt), 'bold')}`
        : paint('banked reset expiry unknown', 'dim'),
    ));
  } else {
    output.push(line(paint('No unexpired banked reset is available.', 'dim')));
  }

  const milestones = [];
  const addMilestone = (at, label, tone = 'dim', kind = 'standard') => {
    if (!at || !Number.isFinite(at.getTime()) || at < report.checkedAt) return;
    milestones.push({ at, label, tone, kind });
  };
  if (recommendation.recommendedAt) {
    addMilestone(
      recommendation.recommendedAt,
      lowConfidenceFuture
        ? 'RECHECK PROVISIONAL FORECAST'
        : recommendation.action === 'USE_NOW'
          ? 'USE BANKED RESET NOW'
          : 'USE BANKED RESET',
      lowConfidenceFuture ? 'cyan' : actionStyle[recommendation.action] ?? 'yellow',
      'focus',
    );
  }
  if (exhaustsBeforePlanningBoundary(report.fiveHourUsage, report.subscription)) {
    addMilestone(report.fiveHourUsage.estimatedExhaustionAt, '5-HOUR CAPACITY RUNS OUT', 'red', 'risk');
  }
  if (exhaustsBeforePlanningBoundary(report.weeklyUsage, report.subscription)) {
    addMilestone(report.weeklyUsage.estimatedExhaustionAt, 'WEEKLY CAPACITY RUNS OUT', 'red', 'risk');
  }
  if (report.nextSavedReset?.expiresAt) {
    addMilestone(
      report.nextSavedReset.expiresAt,
      'NEXT BANKED RESET EXPIRES',
      urgencyStyle[report.nextSavedReset.urgency] ?? 'dim',
      'risk',
    );
  }
  if (report.subscription?.expiresAt) {
    addMilestone(
      report.subscription.expiresAt,
      'SUBSCRIPTION EXPIRES',
      'red',
      'risk',
    );
  } else if (report.subscription?.renewsAt) {
    addMilestone(report.subscription.renewsAt, 'SUBSCRIPTION RENEWS', 'dim');
  }
  addMilestone(report.fiveHourUsage?.resetsAt, '5-HOUR LIMIT RESETS', 'green');
  addMilestone(report.weeklyUsage?.resetsAt, 'WEEKLY LIMIT RESETS', 'green');
  milestones.sort((a, b) => a.at - b.at || (a.kind === 'focus' ? -1 : 1));
  const visibleMilestones = milestones;

  output.push(separator());
  const milestoneContext = `${report.timeZone} ${glyph.bullet} chronological`;
  const milestoneContextWidth = Math.max(8, inner - visibleLength('KEY MILESTONES') - 1);
  output.push(sides(
    paint('KEY MILESTONES', 'bold'),
    paint(truncate(milestoneContext, milestoneContextWidth), 'dim'),
  ));
  const milestoneRelativeWidth = Math.min(18, Math.max(
    13,
    ...visibleMilestones.map((milestone) => visibleLength(
      milestone.at <= report.checkedAt
        ? 'NOW'
        : `IN ${formatDuration(milestone.at - report.checkedAt)}`,
    )),
  ));
  for (const milestone of visibleMilestones) {
    const relative = milestone.at <= report.checkedAt
      ? 'NOW'
      : `IN ${formatDuration(milestone.at - report.checkedAt)}`;
    const marker = milestone.kind === 'focus'
      ? glyph.focus
      : milestone.kind === 'risk'
        ? glyph.risk
        : glyph.dot;
    const leftPrefix = `${paint(marker, 'bold', milestone.tone)} ${fit(relative, milestoneRelativeWidth)} `;
    const absolute = paint(
      formatDate(milestone.at, report.timeZone, { seconds: false }),
      'dim',
    );
    const maximumLabel = Math.max(8, inner - visibleLength(leftPrefix) - visibleLength(absolute) - 1);
    output.push(sides(
      `${leftPrefix}${paint(truncate(milestone.label, maximumLabel), 'bold', milestone.tone)}`,
      absolute,
    ));
  }

  output.push(separator());
  output.push(line(paint('LIMIT STATUS', 'bold')));
  if (report.subscription) {
    const plan = terminalSafe(report.subscription.planType || 'Subscription');
    const status = report.subscription.expiresAt
      ? `${report.subscription.remainingMs <= 0 ? 'expired' : `expires in ${formatDuration(report.subscription.remainingMs)}`}`
      : report.subscription.renewsAt
        ? `renews in ${formatDuration(report.subscription.renewsAt - report.checkedAt)}`
        : 'expiry unavailable';
    output.push(sides(
      paint(truncate(`PLAN      ${plan}`, Math.max(12, inner - visibleLength(status) - 1)), 'bold'),
      paint(status, report.subscription.remainingMs <= 0 ? 'red' : 'dim'),
    ));
  }
  const appendUsage = (usage, paceUnit) => {
    if (!usage) return;
    const exhaustsBeforeBoundary = exhaustsBeforePlanningBoundary(usage, report.subscription);
    const planningBoundary = planningBoundaryFor(usage, report.subscription);
    const state = exhaustsBeforeBoundary
      ? paint('AT RISK', 'bold', 'red')
      : usage.averagePercentPerDay === null
        ? paint('LEARNING', 'bold', 'dim')
        : paint('ON TRACK', 'bold', 'green');
    output.push(sides(
      `${paint(usage.label.toUpperCase().padEnd(8), 'bold')} ${paint(`${numberLabel(usage.usedPercent)}% used`, 'bold')} ${glyph.bullet} ${numberLabel(usage.remainingPercent)}% left`,
      `reset in ${paint(formatDuration(usage.remainingMs), 'bold')}  ${state}`,
    ));
    if (usage.averagePercentPerDay === null) {
      output.push(line(paint('          Pace collecting early-window data · LOW confidence', 'dim')));
      return;
    }
    const pace = paceUnit === 'hour' ? usage.averagePercentPerHour : usage.averagePercentPerDay;
    const paceBasis = usage.paceSource === 'recorded_history'
      ? 'recorded delta'
      : 'day/night weighted';
    const outcome = exhaustsBeforeBoundary
      ? `empty in ${formatDuration(usage.estimatedExhaustionAt - report.checkedAt)}`
      : planningBoundary.type === 'subscription_expiry'
        ? 'subscription ends first'
      : 'lasts through reset';
    output.push(...wrappedLines(
      `Pace ${numberLabel(pace, 2)} points/${paceUnit} ${glyph.bullet} ${paceBasis} ${glyph.bullet} ${usage.confidence} confidence ${glyph.bullet} ${outcome}`,
      '  ',
      'dim',
    ));
  };
  if (!report.fiveHourUsage && !report.weeklyUsage) {
    output.push(line(paint('Usage data is unavailable in this response.', 'dim')));
  } else {
    appendUsage(report.fiveHourUsage, 'hour');
    appendUsage(report.weeklyUsage, 'day');
  }

  if (count === 0) {
    output.push(separator());
    output.push(sides(paint('BANKED RESETS', 'bold'), paint('NONE AVAILABLE', 'dim')));
    output.push(line('No banked resets are currently available.'));
  } else {
    output.push(separator());
    output.push(sides(
      paint('BANKED RESETS', 'bold'),
      paint(`${count} AVAILABLE`, 'bold', 'green'),
    ));
    for (const [index, credit] of report.credits.entries()) {
      const number = String(index + 1).padStart(2, '0');
      const badge = paint(credit.urgency, 'bold', urgencyStyle[credit.urgency]);
      const creditRight = credit.expiresAt
        ? `expires in ${paint(formatDuration(credit.remainingMs), 'bold')}  ${badge}`
        : `${paint('expiry unknown', 'dim')}  ${badge}`;
      const creditPrefix = `${paint(number, 'dim')}  `;
      const nextLabel = index === 0 ? `  ${paint('NEXT', 'yellow')}` : '';
      const titleWidth = Math.max(
        4,
        inner
          - visibleLength(creditPrefix)
          - visibleLength(nextLabel)
          - visibleLength(creditRight)
          - 1,
      );
      output.push(sides(
        `${creditPrefix}${paint(truncate('Banked reset', titleWidth), 'bold')}${nextLabel}`,
        creditRight,
      ));

      if (credit.expiresAt) {
        const local = formatDate(credit.expiresAt, report.timeZone, { seconds: false });
        const utc = formatDate(credit.expiresAt, 'UTC', { seconds: false, weekday: false });
        const utcDetail = report.timeZone === 'UTC' ? '' : ` ${glyph.bullet} UTC ${utc.replace(/ UTC$/, '')}`;
        const idDetail = showIds ? ` ${glyph.bullet} ${idLabel(credit.id)}` : '';
        output.push(line(paint(truncate(`    ${local}${utcDetail}${idDetail}`, inner), 'dim')));
      } else {
        if (showIds) output.push(line(paint(`    ${idLabel(credit.id)}`, 'dim')));
      }
    }
  }

  output.push(separator());
  output.push(line([
    paint('EXPIRY', 'dim'), '  ',
    paint('NOW', 'bold', 'red'), ' <=1h  ',
    paint('SOON', 'bold', 'yellow'), ' <=6h  ',
    paint('TODAY', 'bold', 'cyan'), ' <=24h  ',
    paint('LATER', 'bold', 'green'), ' >24h',
  ].join('')));
  output.push(border(glyph.bl, glyph.br));
  return `${output.join('\n')}\n`;
}

export function renderTable(report, options = {}) {
  const requestedWidth = Number(options.width);
  const width = Math.min(120, Math.max(40, Number.isFinite(requestedWidth) ? requestedWidth : 96));
  if (!options.brief && width >= 68) return renderDetailedTable(report, options);
  return renderCompactTable(report, options);
}
