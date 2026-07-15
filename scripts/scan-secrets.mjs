#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { lstat, readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const TOKEN_PATTERNS = [
  ['openai-token', /\bsk-(?!ant-)(?:proj-|svcacct-)?[A-Za-z0-9_-]{20,}\b/g],
  ['anthropic-token', /\bsk-ant-(?:api\d{2}-)?[A-Za-z0-9_-]{20,}\b/g],
  ['github-token', /\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,})\b/g],
  ['gitlab-token', /\bglpat-[A-Za-z0-9_-]{20,}\b/g],
  ['slack-token', /\bxox[baprs]-[A-Za-z0-9-]{20,}\b/g],
  ['npm-token', /\bnpm_[A-Za-z0-9]{30,}\b/g],
  ['pypi-token', /\bpypi-[A-Za-z0-9_-]{30,}\b/g],
  ['huggingface-token', /\bhf_[A-Za-z0-9]{30,}\b/g],
  ['google-api-key', /\bAIza[0-9A-Za-z_-]{30,}\b/g],
  ['aws-access-key', /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/g],
  ['stripe-live-key', /\b(?:sk|rk)_live_[A-Za-z0-9]{20,}\b/g],
  ['sendgrid-token', /\bSG\.[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{20,}\b/g],
  ['digitalocean-token', /\bdop_v1_[A-Fa-f0-9]{40,}\b/g],
];

const PRIVATE_KEY_PATTERN = /-----BEGIN[ \t]+(?:RSA[ \t]+|EC[ \t]+|DSA[ \t]+|OPENSSH[ \t]+|PGP[ \t]+|ENCRYPTED[ \t]+)?PRIVATE[ \t]+KEY(?:[ \t]+BLOCK)?-----/g;
const BEARER_PATTERN = /\bBearer[ \t]+([A-Za-z0-9._~+/-]{16,})\b/gi;
const JWT_PATTERN = /\b([A-Za-z0-9_-]{8,})\.([A-Za-z0-9_-]{8,})\.([A-Za-z0-9_-]{8,})\b/g;
const SYNTHETIC_MARKER = /synthetic|example|placeholder|dummy|fake|redacted|not[-_ ]?(?:a[-_ ]?)?real|test[-_ ]?only/i;
const PLACEHOLDER_VALUE = /^(?:your[-_ ]?)?(?:access[-_ ]?)?(?:api[-_ ]?)?(?:token|key)(?:[-_ ]?here)?$/i;
const EXPLICIT_ALLOW = /secret-scan:\s*allow-synthetic\b/i;

function clearlySynthetic(value, sourceLine) {
  return SYNTHETIC_MARKER.test(value)
    || PLACEHOLDER_VALUE.test(value)
    || /^x{16,}$/i.test(value)
    || EXPLICIT_ALLOW.test(sourceLine);
}

function decodeJsonSegment(segment) {
  try {
    return JSON.parse(Buffer.from(segment, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
}

function isJwt(headerSegment, payloadSegment) {
  const header = decodeJsonSegment(headerSegment);
  const payload = decodeJsonSegment(payloadSegment);
  if (!header || !payload || typeof header !== 'object' || typeof payload !== 'object') return false;

  const hasJwtHeader = typeof header.alg === 'string' || header.typ === 'JWT';
  const hasStandardClaim = ['aud', 'exp', 'iat', 'iss', 'nbf', 'sub'].some((claim) => (
    Object.hasOwn(payload, claim)
  ));
  return hasJwtHeader && hasStandardClaim;
}

function record(findings, seen, line, type) {
  const key = `${line}:${type}`;
  if (seen.has(key)) return;
  seen.add(key);
  findings.push({ line, type });
}

export function scanText(text) {
  const findings = [];
  const seen = new Set();
  const lines = String(text).split(/\r?\n/);

  lines.forEach((sourceLine, index) => {
    const line = index + 1;

    PRIVATE_KEY_PATTERN.lastIndex = 0;
    const privateKey = PRIVATE_KEY_PATTERN.exec(sourceLine);
    if (privateKey && !clearlySynthetic(privateKey[0], sourceLine)) {
      record(findings, seen, line, 'private-key');
    }

    for (const [type, pattern] of TOKEN_PATTERNS) {
      pattern.lastIndex = 0;
      for (const match of sourceLine.matchAll(pattern)) {
        if (!clearlySynthetic(match[0], sourceLine)) record(findings, seen, line, type);
      }
    }

    BEARER_PATTERN.lastIndex = 0;
    for (const match of sourceLine.matchAll(BEARER_PATTERN)) {
      if (!clearlySynthetic(match[1], sourceLine)) record(findings, seen, line, 'bearer-token');
    }

    JWT_PATTERN.lastIndex = 0;
    for (const match of sourceLine.matchAll(JWT_PATTERN)) {
      if (isJwt(match[1], match[2]) && !clearlySynthetic(match[0], sourceLine)) {
        record(findings, seen, line, 'jwt');
      }
    }
  });

  return findings;
}

function trackedFiles(root) {
  const output = execFileSync(
    'git',
    ['-C', root, 'ls-files', '--cached', '--others', '--exclude-standard', '-z'],
    {
    encoding: 'buffer',
    stdio: ['ignore', 'pipe', 'ignore'],
    },
  );
  return output.toString('utf8').split('\0').filter(Boolean);
}

export async function scanTrackedFiles(root) {
  const findings = [];

  for (const file of trackedFiles(root)) {
    const path = resolve(root, file);
    let contents;
    try {
      const metadata = await lstat(path);
      if (!metadata.isFile()) continue;
      contents = await readFile(path);
    } catch (error) {
      if (error?.code === 'ENOENT') continue;
      throw error;
    }

    // Secret formats covered here are textual. Skipping NUL-containing files avoids
    // decoding binaries and producing unreliable line numbers.
    if (contents.includes(0)) continue;
    for (const finding of scanText(contents.toString('utf8'))) {
      findings.push({ file, ...finding });
    }
  }

  return findings;
}

async function main() {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const findings = await scanTrackedFiles(root);
  for (const { file, line, type } of findings) process.stderr.write(`${file}:${line}:${type}\n`);
  if (findings.length > 0) process.exitCode = 1;
}

const entryPoint = process.argv[1] ? resolve(process.argv[1]) : '';
if (entryPoint === fileURLToPath(import.meta.url)) {
  main().catch(() => {
    process.stderr.write('secret-scan:0:scan-error\n');
    process.exitCode = 2;
  });
}
