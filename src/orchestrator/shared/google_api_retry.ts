interface ApiErrorLike {
  code?: string | number;
  message?: string;
  response?: {
    status?: number;
    data?: {
      error?: {
        message?: string;
        errors?: Array<{ reason?: string }>;
      };
    };
  };
  errors?: Array<{ reason?: string }>;
}

export interface GoogleApiErrorMeta {
  status: number;
  code: string;
  reason: string;
  message: string;
}

export interface GoogleApiRetryOptions {
  maxAttempts?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  jitterMs?: number;
  loggerPrefix?: string;
}

export function parsePositiveInt(raw: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(String(raw || ''), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return parsed;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function extractGoogleApiError(error: unknown): GoogleApiErrorMeta {
  const err = (error || {}) as ApiErrorLike;
  const status = Number(err.response?.status || err.code || 0);
  const code = String(err.code || '');
  const reason =
    String(err.errors?.[0]?.reason || '') ||
    String(err.response?.data?.error?.errors?.[0]?.reason || '');
  const message = String(err.response?.data?.error?.message || err.message || '');
  return { status, code, reason, message };
}

export function isRetryableGoogleApiError(error: unknown): boolean {
  const { status, code, reason, message } = extractGoogleApiError(error);
  if ([408, 409, 425, 429, 500, 502, 503, 504].includes(status)) return true;
  if (['ECONNRESET', 'ETIMEDOUT', 'EAI_AGAIN', 'ENOTFOUND', 'ECONNREFUSED', 'ECONNABORTED', 'EPIPE'].includes(code)) return true;
  if (['rateLimitExceeded', 'userRateLimitExceeded', 'quotaExceeded', 'backendError', 'internalError'].includes(reason)) return true;
  const msg = message.toLowerCase();
  return msg.includes('timeout') || msg.includes('quota') || msg.includes('rate limit') || msg.includes('backend error');
}

export async function withGoogleApiRetry<T>(
  operation: string,
  fn: () => Promise<T>,
  options: GoogleApiRetryOptions = {}
): Promise<T> {
  const maxAttempts = Math.max(1, options.maxAttempts ?? 4);
  const baseDelayMs = Math.max(200, options.baseDelayMs ?? 1500);
  const maxDelayMs = Math.max(baseDelayMs, options.maxDelayMs ?? 15000);
  const jitterMs = Math.max(0, options.jitterMs ?? 250);
  const loggerPrefix = options.loggerPrefix || 'google_api_retry';

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      const retryable = isRetryableGoogleApiError(error);
      const isLast = attempt >= maxAttempts;
      if (!retryable || isLast) throw error;

      const meta = extractGoogleApiError(error);
      const jitter = Math.floor(Math.random() * (jitterMs + 1));
      const waitMs = Math.min(maxDelayMs, baseDelayMs * attempt + jitter);
      console.warn(
        `[${loggerPrefix}] ${operation} failed (${attempt}/${maxAttempts}), retry in ${waitMs}ms: ${meta.message || meta.reason || meta.code || meta.status}`
      );
      await sleep(waitMs);
    }
  }
  throw new Error(`${operation}: exhausted retries`);
}
