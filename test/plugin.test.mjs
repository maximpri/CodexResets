import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import {
  chmodSync,
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import test from 'node:test';

const pluginRoot = new URL('../plugins/codexresets/', import.meta.url).pathname;
const launcher = join(
  pluginRoot,
  'skills/check-codex-resets/scripts/codexresets.sh',
);

function createMockBinary(directory) {
  const binary = join(directory, 'codexresets');
  const argsFile = join(directory, 'args');
  writeFileSync(binary, '#!/bin/sh\nprintf "%s\\n" "$*" > "$CODEXRESETS_TEST_ARGS"\nprintf "mock report\\n"\n');
  chmodSync(binary, 0o755);
  return { binary, argsFile };
}

test('launcher calls the CodexResets app from PATH and forwards arguments', () => {
  const directory = mkdtempSync(join(tmpdir(), 'codexresets-plugin-'));
  const binDirectory = join(directory, 'bin');
  mkdirSync(binDirectory);
  const { argsFile } = createMockBinary(binDirectory);

  const output = execFileSync('bash', [launcher, '--format', 'json', '--timezone', 'UTC'], {
    encoding: 'utf8',
    env: {
      ...process.env,
      PATH: `${binDirectory}${delimiter}${process.env.PATH}`,
      CODEXRESETS_TEST_ARGS: argsFile,
    },
  });

  assert.equal(output, 'mock report\n');
  assert.equal(readFileSync(argsFile, 'utf8').trim(), '--format json --timezone UTC');
});

test('launcher uses the visible installed-binary pointer when PATH has no app', () => {
  const directory = mkdtempSync(join(tmpdir(), 'codexresets-plugin-'));
  const copiedPlugin = join(directory, 'codexresets');
  cpSync(pluginRoot, copiedPlugin, { recursive: true });

  const scriptsDirectory = join(copiedPlugin, 'skills/check-codex-resets/scripts');
  const mockDirectory = join(directory, 'mock-bin');
  mkdirSync(mockDirectory);
  const { binary, argsFile } = createMockBinary(mockDirectory);
  writeFileSync(join(scriptsDirectory, 'codexresets-bin'), `${binary}\n`, { mode: 0o600 });

  const output = execFileSync('bash', [join(scriptsDirectory, 'codexresets.sh'), '--brief'], {
    encoding: 'utf8',
    env: {
      ...process.env,
      PATH: '/usr/bin:/bin',
      CODEXRESETS_TEST_ARGS: argsFile,
    },
  });

  assert.equal(output, 'mock report\n');
  assert.equal(readFileSync(argsFile, 'utf8').trim(), '--brief');
});
