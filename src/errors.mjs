export class SafeError extends Error {
  constructor(message, { cause, retryable = false } = {}) {
    super(message, { cause });
    this.name = 'SafeError';
    this.retryable = Boolean(retryable);
  }
}
