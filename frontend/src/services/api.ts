export class ApiError extends Error {
  code: string;
  status: number;
  details: Record<string, any>;

  constructor(status: number, code: string, message: string, details: Record<string, any> = {}) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export const CONNECTION_STATUS_EVENT = 'alas-connection-status';

const PROXY_ERROR_PATTERN = /Error occurred while trying to proxy|ECONNREFUSED|ECONNRESET|socket hang up/i;
const CONNECTION_ERROR_CODES = new Set(['CONNECTION_FAILED', 'SERVICE_UNAVAILABLE']);

export type ConnectionStatusDetail = {
  connected: boolean;
  message?: string;
};

export function isNetworkFetchError(error: unknown) {
  if (!(error instanceof TypeError)) return false;
  const message = error.message.toLowerCase();
  return !message
    || message.includes('failed to fetch')
    || message.includes('networkerror')
    || message.includes('load failed')
    || message.includes('fetch failed')
    || message.includes('network request failed');
}

export function isConnectionFailureError(error: unknown) {
  if (isNetworkFetchError(error)) return true;
  if (!(error instanceof ApiError)) return false;
  return [502, 503, 504].includes(error.status)
    || CONNECTION_ERROR_CODES.has(error.code);
}

export function reportConnectionStatus(connected: boolean, message?: string) {
  window.dispatchEvent(new CustomEvent<ConnectionStatusDetail>(
    CONNECTION_STATUS_EVENT,
    { detail: { connected, message } },
  ));
}

export async function api<T = any>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }
  let response: Response;
  try {
    response = await fetch(path, {
      ...init,
      credentials: 'same-origin',
      headers,
    });
  } catch (error) {
    if (isNetworkFetchError(error)) {
      reportConnectionStatus(false, error instanceof Error ? error.message : String(error));
    }
    throw error;
  }
  reportConnectionStatus(true);
  if (response.status === 204) {
    return undefined as T;
  }
  const rawBody = await response.text();
  let data: any = {};
  try {
    data = rawBody ? JSON.parse(rawBody) : {};
  } catch {
    data = rawBody;
  }
  if (!response.ok) {
    const error = data?.error || {};
    const traceback = data?.traceback || (typeof data === 'string' ? data : undefined);
    const isProxyFailure = [502, 503, 504].includes(response.status)
      || (response.status === 500 && PROXY_ERROR_PATTERN.test(rawBody));
    if (!error.message && traceback) {
      const tracebackLines = traceback.split('\n').filter(Boolean);
      error.message = tracebackLines[tracebackLines.length - 1] || `Request failed: ${response.status}`;
    }
    if (response.status === 401 && !location.hash.startsWith('#/login')) {
      location.hash = '#/login';
    }
    const apiError = new ApiError(
      response.status,
      isProxyFailure ? 'CONNECTION_FAILED' : (error.code || 'REQUEST_FAILED'),
      error.message || `Request failed: ${response.status}`,
      {
        ...(error.details || {}),
        ...(traceback ? { traceback } : {}),
      },
    );
    if (isConnectionFailureError(apiError)) {
      reportConnectionStatus(false, apiError.message);
    }
    throw apiError;
  }
  return data as T;
}
