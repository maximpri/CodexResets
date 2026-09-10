import { spawn } from 'node:child_process';
import { createInterface as createLineReader } from 'node:readline';
import { SafeError } from './errors.mjs';

function requestLabel(method) {
  if (method === 'account/rateLimits/read') return 'account limits';
  if (method === 'account/rateLimitResetCredit/consume') return 'banked reset';
  return 'account request';
}

/**
 * Make one JSON-RPC request through Codex's authenticated app-server.
 *
 * The app-server owns the active Codex account session and talks to the
 * supported account APIs on the CLI's behalf. This avoids duplicating the
 * browser-facing ChatGPT authentication flow in CodexResets.
 */
export async function callCodexAppServer(method, params = {}, dependencies = {}) {
  const spawnImpl = dependencies.spawnImpl ?? spawn;
  const timeoutMs = dependencies.timeoutMs ?? 15_000;
  const label = requestLabel(method);

  return new Promise((resolve, reject) => {
    let child;
    let settled = false;
    let requestSent = false;
    let timer;
    let reader;

    const finish = (error, result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reader?.close();
      child?.stdin?.end();
      if (child && !child.killed) child.kill();
      if (error) reject(error);
      else resolve(result);
    };

    const write = (message) => {
      try {
        child.stdin.write(`${JSON.stringify(message)}\n`);
      } catch {
        finish(new SafeError(`Could not communicate with the Codex ${label} service.`, {
          retryable: true,
        }));
      }
    };

    try {
      child = spawnImpl('codex', ['app-server'], {
        stdio: ['pipe', 'pipe', 'ignore'],
      });
    } catch {
      finish(new SafeError('Could not start the Codex app server. Confirm the Codex CLI is installed.'));
      return;
    }

    child.once('error', () => {
      finish(new SafeError('Could not start the Codex app server. Confirm the Codex CLI is installed.'));
    });
    child.once('exit', () => {
      if (!settled) {
        finish(new SafeError(`The Codex app server stopped before completing the ${label} request.`, {
          retryable: true,
        }));
      }
    });
    child.stdin.on('error', () => {
      if (!settled) {
        finish(new SafeError(`Could not communicate with the Codex ${label} service.`, {
          retryable: true,
        }));
      }
    });

    reader = createLineReader({ input: child.stdout });
    reader.on('line', (line) => {
      let message;
      try {
        message = JSON.parse(line);
      } catch {
        finish(new SafeError('The Codex app server returned an invalid response.', {
          retryable: true,
        }));
        return;
      }

      if (message.id === 1) {
        if (message.error) {
          finish(new SafeError('The Codex app server rejected initialization.'));
          return;
        }
        write({ method: 'initialized', params: {} });
        write({ method, id: 2, params });
        requestSent = true;
        return;
      }

      if (message.id === 2 && requestSent) {
        if (message.error) {
          finish(new SafeError(`The Codex app server rejected the ${label} request.`));
          return;
        }
        finish(null, message.result);
      }
    });

    timer = setTimeout(() => {
      finish(new SafeError(`The Codex ${label} service request timed out.`, { retryable: true }));
    }, timeoutMs);

    write({
      method: 'initialize',
      id: 1,
      params: {
        clientInfo: {
          name: 'codexresets',
          title: 'CodexResets',
          version: '1.0.0',
        },
      },
    });
  });
}
