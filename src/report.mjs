const HOUR = 60 * 60 * 1000;

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
const plural = (count, singular, multiple = `${singular}s`) => count === 1 ? singular : multiple;

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

function creditId(credit) {
  return String(credit?.id ?? credit?.credit_id ?? '');
}

export function normalizeReport(data, { now = new Date(), timeZone } = {}) {
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

  return { checkedAt, timeZone, credits };
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
  if (!id) return 'ID unavailable';
  const tail = id.includes('_') ? id.slice(id.lastIndexOf('_') + 1) : id;
  return `ID …${tail.slice(-8)}`;
}

export function renderJson(report, { showIds = false } = {}) {
  const output = {
    checked_at: report.checkedAt.toISOString(),
    time_zone: report.timeZone,
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

export function renderTable(report, options = {}) {
  const color = Boolean(options.color);
  const ascii = Boolean(options.ascii);
  const showIds = Boolean(options.showIds);
  const requestedWidth = Number(options.width);
  const width = Math.min(120, Math.max(68, Number.isFinite(requestedWidth) ? requestedWidth : 96));
  const inner = width - 4;
  const glyph = ascii
    ? { tl: '+', tr: '+', bl: '+', br: '+', h: '-', v: '|', ml: '+', mr: '+' }
    : { tl: '╭', tr: '╮', bl: '╰', br: '╯', h: '─', v: '│', ml: '├', mr: '┤' };

  const paint = (value, ...styles) => color
    ? `${styles.map((style) => ANSI[style]).join('')}${value}${ANSI.reset}`
    : String(value);
  const urgencyStyle = { NOW: 'red', SOON: 'yellow', TODAY: 'cyan', LATER: 'green', UNKNOWN: 'dim' };
  const fit = (value, maximum) => truncate(value, maximum).padEnd(maximum);
  const line = (content = '') => {
    const padding = Math.max(0, inner - visibleLength(content));
    return `${glyph.v} ${content}${' '.repeat(padding)} ${glyph.v}`;
  };
  const sides = (left, right) => {
    const gap = Math.max(1, inner - visibleLength(left) - visibleLength(right));
    return line(`${left}${' '.repeat(gap)}${right}`);
  };
  const border = (left, right) => `${left}${glyph.h.repeat(width - 2)}${right}`;
  const separator = () => border(glyph.ml, glyph.mr);

  const output = [border(glyph.tl, glyph.tr)];
  output.push(line(paint('CODEX  /  RESET CREDITS', 'bold')));
  const count = report.credits.length;
  output.push(sides(
    paint(`${count} available ${plural(count, 'credit')}`, count ? 'green' : 'dim'),
    paint(`checked ${formatDate(report.checkedAt, report.timeZone, { seconds: false, weekday: false })}`, 'dim'),
  ));
  output.push(line(paint(report.timeZone, 'dim')));

  if (count === 0) {
    output.push(separator());
    output.push(line('No reset credits are currently available.'));
  } else {
    for (const [index, credit] of report.credits.entries()) {
      output.push(separator());
      const number = String(index + 1).padStart(2, '0');
      const badge = paint(credit.urgency, 'bold', urgencyStyle[credit.urgency]);
      const titleWidth = Math.max(8, inner - 8 - visibleLength(credit.urgency));
      output.push(sides(
        `${paint(number, 'dim')}  ${paint(fit(terminalSafe(credit.title) || 'Reset credit', titleWidth), 'bold')}`,
        badge,
      ));

      if (credit.expiresAt) {
        const local = formatDate(credit.expiresAt, report.timeZone);
        const timeLeft = credit.remainingMs <= 0
          ? paint('expired', 'red')
          : `in ${paint(formatDuration(credit.remainingMs), 'bold')}`;
        output.push(sides(`    ${local}`, timeLeft));
        const utc = formatDate(credit.expiresAt, 'UTC', { seconds: false, weekday: false });
        const detail = showIds ? `${utc}  ·  ${idLabel(credit.id)}` : utc;
        output.push(line(paint(`    UTC ${detail.replace(/ UTC$/, '')}`, 'dim')));
      } else {
        output.push(line(paint('    Expiry time unavailable', 'red')));
        if (showIds) output.push(line(paint(`    ${idLabel(credit.id)}`, 'dim')));
      }
    }
  }

  output.push(separator());
  output.push(line([
    paint('NOW', 'bold', 'red'), ' ≤1h  ',
    paint('SOON', 'bold', 'yellow'), ' ≤6h  ',
    paint('TODAY', 'bold', 'cyan'), ' ≤24h  ',
    paint('LATER', 'bold', 'green'), ' >24h',
  ].join('')));
  output.push(border(glyph.bl, glyph.br));
  return `${output.join('\n')}\n`;
}
