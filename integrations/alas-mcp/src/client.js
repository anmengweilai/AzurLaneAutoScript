/**
 * Thin client for the Alas Control API (/api/v1).
 *
 * Authentication matches the server: a Bearer password when one is configured,
 * or nothing at all from a loopback address.
 */

export class AlasError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.name = 'AlasError';
    this.status = status;
    this.code = code;
    this.details = details ?? {};
  }

  toJSON() {
    return { status: this.status, code: this.code, message: this.message, details: this.details };
  }
}

const DEFAULT_TIMEOUT_MS = 15_000;

export class AlasClient {
  /**
   * @param {object} options
   * @param {string} [options.baseUrl] panel origin, e.g. http://127.0.0.1:22267
   * @param {string|null} [options.password] Control API password, when one is set
   * @param {number} [options.timeoutMs]
   */
  constructor({ baseUrl = 'http://127.0.0.1:22267', password = null, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
    this.baseUrl = String(baseUrl).replace(/\/+$/, '');
    this.password = password || null;
    this.timeoutMs = timeoutMs;
    const parsed = new URL(this.baseUrl);
    this.wsUrl = `${parsed.protocol === 'https:' ? 'wss:' : 'ws:'}//${parsed.host}`;
  }

  headers(extra = {}) {
    const headers = { Accept: 'application/json', ...extra };
    if (this.password) {
      headers.Authorization = `Bearer ${this.password}`;
    }
    return headers;
  }

  async request(path, { method = 'GET', body, timeoutMs = this.timeoutMs } = {}) {
    const headers = this.headers();
    const init = { method, headers, signal: AbortSignal.timeout(timeoutMs) };
    if (body !== undefined) {
      headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(body);
    }

    let response;
    try {
      response = await fetch(`${this.baseUrl}${path}`, init);
    } catch (error) {
      if (error?.name === 'TimeoutError') {
        throw new AlasError(0, 'TIMEOUT', `Alas did not answer ${method} ${path} within ${timeoutMs} ms`);
      }
      throw new AlasError(0, 'UNREACHABLE', `Cannot reach Alas at ${this.baseUrl}: ${error?.message ?? error}`);
    }

    if (response.status === 204) {
      return null;
    }

    const text = await response.text();
    let data = null;
    if (text) {
      try {
        data = JSON.parse(text);
      } catch {
        data = text;
      }
    }

    if (!response.ok) {
      const error = data?.error ?? {};
      throw new AlasError(
        response.status,
        error.code || 'REQUEST_FAILED',
        error.message || (typeof data === 'string' && data ? data : `Request failed: ${response.status}`),
        error.details,
      );
    }
    return data;
  }

  // --- instances -----------------------------------------------------------

  listInstances() {
    return this.request('/api/v1/instances');
  }

  getInstance(name) {
    return this.request(`/api/v1/instances/${encodeURIComponent(name)}`);
  }

  startInstance(name, task) {
    return this.request(`/api/v1/instances/${encodeURIComponent(name)}/start`, {
      method: 'POST',
      body: task ? { task } : {},
    });
  }

  stopInstance(name) {
    return this.request(`/api/v1/instances/${encodeURIComponent(name)}/stop`, { method: 'POST', body: {} });
  }

  restartInstance(name, task) {
    return this.request(`/api/v1/instances/${encodeURIComponent(name)}/restart`, {
      method: 'POST',
      body: task ? { task } : {},
    });
  }

  instanceOverview(name) {
    return this.request(`/api/v1/instances/${encodeURIComponent(name)}/overview`);
  }

  instanceTemplates() {
    return this.request('/api/v1/instances/templates');
  }

  createInstance(name, copyFrom) {
    return this.request('/api/v1/instances', { method: 'POST', body: { name, copy_from: copyFrom } });
  }

  // --- config --------------------------------------------------------------

  getConfig(name) {
    return this.request(`/api/v1/instances/${encodeURIComponent(name)}/config`);
  }

  patchConfig(name, changes, { dryRun = false } = {}) {
    return this.request(`/api/v1/instances/${encodeURIComponent(name)}/config`, {
      method: 'PATCH',
      body: dryRun ? { changes, dry_run: true } : { changes },
    });
  }

  validateConfig(name, changes) {
    return this.request(`/api/v1/instances/${encodeURIComponent(name)}/config/validate`, {
      method: 'POST',
      body: { changes },
    });
  }

  exportConfig(name) {
    return this.request(`/api/v1/instances/${encodeURIComponent(name)}/config/export`);
  }

  configSchema(mod = 'alas') {
    return this.request(`/api/v1/config/schema/${encodeURIComponent(mod)}`);
  }

  configMenu(mod = 'alas') {
    return this.request(`/api/v1/config/menu/${encodeURIComponent(mod)}`);
  }

  // --- system --------------------------------------------------------------

  health() {
    return this.request('/api/v1/health');
  }

  version() {
    return this.request('/api/v1/version');
  }

  runtime() {
    return this.request('/api/v1/system/runtime');
  }

  bootstrap() {
    return this.request('/api/v1/bootstrap');
  }

  settings() {
    return this.request('/api/v1/settings');
  }

  updateSettings(patch) {
    return this.request('/api/v1/settings', { method: 'PATCH', body: patch });
  }

  updateStatus() {
    return this.request('/api/v1/update/status');
  }

  updateCheck() {
    return this.request('/api/v1/update/check', { method: 'POST', body: {} });
  }

  updateRun() {
    return this.request('/api/v1/update/run', { method: 'POST', body: {} });
  }

  updateCancel() {
    return this.request('/api/v1/update/cancel', { method: 'POST', body: {} });
  }

  remoteAccess() {
    return this.request('/api/v1/remote-access/status');
  }

  i18n(locale = 'zh-CN') {
    return this.request(`/api/v1/i18n/${encodeURIComponent(locale)}`);
  }

  // --- logs ----------------------------------------------------------------

  /**
   * Read buffered log events for one instance over the Control API's WebSocket.
   *
   * @param {string} name instance name
   * @param {object} [options]
   * @param {number} [options.limit] maximum events to return, newest window when cursor is omitted
   * @param {number|null} [options.cursor] resume after this sequence number
   * @param {number} [options.waitMs] how long to keep listening for live output
   */
  async logs(name, { limit = 80, cursor = null, waitMs = 2000 } = {}) {
    const info = await this.getInstance(name);
    const latest = Number(info?.log_cursor ?? 0);
    const start = Number.isInteger(cursor) ? cursor : Math.max(0, latest - limit);

    const params = new URLSearchParams({ cursor: String(start) });
    if (this.password) {
      params.set('token', this.password);
    }
    const url = `${this.wsUrl}/api/v1/instances/${encodeURIComponent(name)}/logs?${params}`;

    const events = [];
    const closeReason = await new Promise((resolve) => {
      if (typeof WebSocket !== 'function') {
        resolve({ code: 0, reason: 'WebSocket is unavailable in this Node runtime' });
        return;
      }

      let socket;
      let idle;
      let settled = false;
      const finish = (reason) => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(idle);
        clearTimeout(deadline);
        try {
          socket.close();
        } catch {
          /* already closed */
        }
        resolve(reason);
      };
      const bumpIdle = () => {
        clearTimeout(idle);
        idle = setTimeout(() => finish({ code: 1000, reason: 'idle' }), waitMs);
      };
      const deadline = setTimeout(() => finish({ code: 1000, reason: 'deadline' }), waitMs + 5000);

      try {
        socket = new WebSocket(url);
      } catch (error) {
        resolve({ code: 0, reason: `WebSocket failed: ${error?.message ?? error}` });
        return;
      }

      socket.addEventListener('open', () => {
        bumpIdle();
        // Historical events arrive immediately; stop once the window is full.
        if (start >= latest && latest > 0) {
          setTimeout(() => finish({ code: 1000, reason: 'caught-up' }), 250);
        }
      });
      socket.addEventListener('message', (message) => {
        let payload;
        try {
          payload = JSON.parse(typeof message.data === 'string' ? message.data : String(message.data));
        } catch {
          return;
        }
        if (!payload || payload.type === 'heartbeat' || typeof payload.message !== 'string') {
          bumpIdle();
          return;
        }
        events.push(payload);
        bumpIdle();
        if (events.length >= limit) {
          finish({ code: 1000, reason: 'limit' });
        }
      });
      socket.addEventListener('error', () => finish({ code: 0, reason: 'WebSocket error' }));
      socket.addEventListener('close', (event) => finish({ code: event.code, reason: event.reason || 'closed' }));
    });

    if (events.length === 0 && closeReason.code === 4401) {
      throw new AlasError(401, 'UNAUTHENTICATED', 'Alas rejected the log stream: a Control API password is required');
    }
    if (events.length === 0 && closeReason.code === 4404) {
      throw new AlasError(404, 'INSTANCE_NOT_FOUND', `Instance not found: ${name}`);
    }

    return {
      instance: name,
      cursor: events.length ? events[events.length - 1].seq : start,
      latest,
      count: events.length,
      closed_by: closeReason.reason,
      events: events.map((event) => ({
        seq: event.seq,
        time: event.timestamp,
        level: event.level,
        message: event.message,
      })),
    };
  }
}

/** Build a client from environment variables (ALAS_BASE_URL / ALAS_PASSWORD). */
export function clientFromEnv(env = process.env) {
  return new AlasClient({
    baseUrl: env.ALAS_BASE_URL || 'http://127.0.0.1:22267',
    password: env.ALAS_PASSWORD || null,
    timeoutMs: Number(env.ALAS_TIMEOUT_MS || DEFAULT_TIMEOUT_MS),
  });
}