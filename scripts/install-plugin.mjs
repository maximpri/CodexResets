import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

const pluginName = 'codexresets';
const marketplaceName = 'personal';

function fail(message) {
  console.error(`Plugin setup failed: ${message}`);
  process.exit(1);
}

function argumentValue(args, name) {
  const index = args.indexOf(name);
  if (index === -1 || !args[index + 1]) {
    fail(`missing ${name} value`);
  }
  return args[index + 1];
}

const args = process.argv.slice(2);
const source = resolve(argumentValue(args, '--source'));
const binary = resolve(argumentValue(args, '--binary'));
const pluginDirectory = join(homedir(), 'plugins', pluginName);
const marketplacePath = join(homedir(), '.agents', 'plugins', 'marketplace.json');

if (!existsSync(join(source, '.codex-plugin', 'plugin.json'))) {
  fail(`missing plugin manifest under ${source}`);
}

let manifest;
try {
  manifest = JSON.parse(readFileSync(join(source, '.codex-plugin', 'plugin.json'), 'utf8'));
} catch (error) {
  fail(`could not read plugin manifest: ${error.message}`);
}

if (manifest.name !== pluginName) {
  fail(`expected plugin name ${pluginName}, found ${manifest.name ?? 'none'}`);
}

const baseVersion = String(manifest.version ?? '1.0.0').split('+', 1)[0];
const cachebuster = new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 14);

mkdirSync(dirname(pluginDirectory), { recursive: true });
cpSync(source, pluginDirectory, { recursive: true, force: true });
writeFileSync(
  join(pluginDirectory, '.codex-plugin', 'plugin.json'),
  `${JSON.stringify({ ...manifest, version: `${baseVersion}+codex.${cachebuster}` }, null, 2)}\n`,
  'utf8',
);
writeFileSync(join(pluginDirectory, '.codexresets-bin'), `${binary}\n`, { mode: 0o600 });

mkdirSync(dirname(marketplacePath), { recursive: true });
let marketplace = {
  name: marketplaceName,
  interface: { displayName: 'Personal' },
  plugins: [],
};

if (existsSync(marketplacePath)) {
  try {
    marketplace = JSON.parse(readFileSync(marketplacePath, 'utf8'));
  } catch (error) {
    fail(`could not read ${marketplacePath}: ${error.message}`);
  }
  if (marketplace.name !== marketplaceName) {
    fail(`${marketplacePath} is not the personal marketplace`);
  }
  if (!Array.isArray(marketplace.plugins)) {
    fail(`${marketplacePath} does not contain a plugins array`);
  }
}

const entry = {
  name: pluginName,
  source: {
    source: 'local',
    path: `./plugins/${pluginName}`,
  },
  policy: {
    installation: 'AVAILABLE',
    authentication: 'ON_INSTALL',
  },
  category: 'Productivity',
};
const existingIndex = marketplace.plugins.findIndex((plugin) => plugin?.name === pluginName);
if (existingIndex === -1) {
  marketplace.plugins.push(entry);
} else {
  marketplace.plugins[existingIndex] = {
    ...marketplace.plugins[existingIndex],
    ...entry,
  };
}

const temporaryMarketplace = `${marketplacePath}.tmp-${process.pid}`;
writeFileSync(temporaryMarketplace, `${JSON.stringify(marketplace, null, 2)}\n`, 'utf8');
renameSync(temporaryMarketplace, marketplacePath);

console.log(`Installed ${pluginName} plugin source at ${pluginDirectory}`);
console.log(`Registered ${pluginName}@${marketplaceName} in ${marketplacePath}`);
