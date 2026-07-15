import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import test from 'node:test';

const installer = new URL('../install.sh', import.meta.url).pathname;

function installerEnvironment() {
  const directory = mkdtempSync(join(tmpdir(), 'codexresets-install-'));
  const mockBin = join(directory, 'bin');
  const prefix = join(directory, 'prefix');
  const log = join(directory, 'npm.log');
  mkdirSync(mockBin, { recursive: true });

  const node = join(mockBin, 'node');
  writeFileSync(node, '#!/bin/sh\nprintf \'22\\n\'\n');
  chmodSync(node, 0o755);

  const npm = join(mockBin, 'npm');
  writeFileSync(npm, `#!/bin/sh
printf '%s\\n' "$*" >> "$CODEXRESETS_TEST_LOG"
mkdir -p "$CODEXRESETS_PREFIX/bin"
printf '#!/bin/sh\\nprintf "1.0.0\\n"\\n' > "$CODEXRESETS_PREFIX/bin/codexresets"
chmod 755 "$CODEXRESETS_PREFIX/bin/codexresets"
`);
  chmodSync(npm, 0o755);

  return {
    directory,
    log,
    prefix,
    env: {
      ...process.env,
      PATH: `${mockBin}${delimiter}${process.env.PATH}`,
      CODEXRESETS_PREFIX: prefix,
      CODEXRESETS_TEST_LOG: log,
    },
  };
}

test('quick installer uses the fixed GitHub tarball endpoint with lifecycle scripts disabled', () => {
  const { env, log, prefix } = installerEnvironment();
  const output = execFileSync('bash', [installer], { encoding: 'utf8', env });

  assert.match(output, /Installed CodexResets 1\.0\.0/);
  assert.match(output, new RegExp(prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.equal(readFileSync(log, 'utf8').trim(), [
    'install --global --ignore-scripts --no-audit --no-fund',
    `--prefix ${prefix}`,
    'https://api.github.com/repos/maximpri/CodexResets/tarball/main',
  ].join(' '));
});

test('quick installer rejects unsafe refs before invoking npm', () => {
  const { env } = installerEnvironment();
  const result = spawnSync('bash', [installer], {
    encoding: 'utf8',
    env: { ...env, CODEXRESETS_REF: '../unsafe' },
  });

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /unsupported characters/);
});

test('quick installer URL-encodes slashes in a selected ref', () => {
  const { env, log } = installerEnvironment();
  execFileSync('bash', [installer], {
    encoding: 'utf8',
    env: { ...env, CODEXRESETS_REF: 'feature/install' },
  });

  assert.match(
    readFileSync(log, 'utf8'),
    /https:\/\/api\.github\.com\/repos\/maximpri\/CodexResets\/tarball\/feature%2Finstall/,
  );
});

test('quick installer documents its noninteractive options', () => {
  const output = execFileSync('bash', [installer, '--help'], { encoding: 'utf8' });
  assert.match(output, /CodexResets quick installer/);
  assert.match(output, /CODEXRESETS_PREFIX/);
  assert.match(output, /CODEXRESETS_REF/);
});
