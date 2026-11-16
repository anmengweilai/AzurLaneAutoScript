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

export async function api<T = any>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }
  const response = await fetch(path, {
    ...init,
    credentials: 'same-origin',
    headers,
  });
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
    if (!error.message && traceback) {
      const tracebackLines = traceback.split('\n').filter(Boolean);
      error.message = tracebackLines[tracebackLines.length - 1] || `Request failed: ${response.status}`;
    }
    if (response.status === 401 && !location.hash.startsWith('#/login')) {
      location.hash = '#/login';
    }
    throw new ApiError(
      response.status,
      error.code || 'REQUEST_FAILED',
      error.message || `Request failed: ${response.status}`,
      {
        ...(error.details || {}),
        ...(traceback ? { traceback } : {}),
      },
    );
  }
  return data as T;
}
