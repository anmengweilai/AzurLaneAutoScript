import { useEffect, useRef, useState } from 'react';
import { api } from '@/services/api';

type UpdateStatus = {
  state: string;
};

type RuntimeVersion = {
  started_at?: number | string | null;
};

const UPDATE_AVAILABLE_STATE = 'update_available';
const AUTO_RELOAD_STORAGE_KEY = 'alas-global-shell:runtime-started-at';
const UPDATE_POLL_INTERVAL = 10_000;

export function useGlobalAlasStatus(options: {
  connected: boolean;
  authenticated: boolean;
}) {
  const { connected, authenticated } = options;
  const [updateAvailable, setUpdateAvailable] = useState(false);
  const runtimeProbeBusy = useRef(false);

  useEffect(() => {
    if (!connected || !authenticated) {
      return;
    }

    let alive = true;
    const load = async () => {
      try {
        const status = await api<UpdateStatus>('/api/v1/update/status');
        if (alive) {
          setUpdateAvailable(status.state === UPDATE_AVAILABLE_STATE);
        }
      } catch {
        // Keep the previous hint until a successful poll proves it is stale.
      }
    };

    load();
    const timer = window.setInterval(load, UPDATE_POLL_INTERVAL);
    return () => {
      alive = false;
      window.clearInterval(timer);
    };
  }, [authenticated, connected]);

  useEffect(() => {
    if (!connected || !authenticated || runtimeProbeBusy.current) {
      return;
    }

    let alive = true;
    runtimeProbeBusy.current = true;
    api<RuntimeVersion>('/api/v1/version')
      .then((runtime) => {
        if (!alive) return;
        const startedAt = runtime.started_at == null ? '' : String(runtime.started_at);
        if (!startedAt) return;

        const knownStartedAt = sessionStorage.getItem(AUTO_RELOAD_STORAGE_KEY);
        if (knownStartedAt && knownStartedAt !== startedAt) {
          sessionStorage.setItem(AUTO_RELOAD_STORAGE_KEY, startedAt);
          window.location.reload();
          return;
        }
        if (!knownStartedAt) {
          sessionStorage.setItem(AUTO_RELOAD_STORAGE_KEY, startedAt);
        }
      })
      .catch(() => {
        // A blocked or unauthorized runtime probe must not interfere with the shell.
      })
      .finally(() => {
        runtimeProbeBusy.current = false;
      });

    return () => {
      alive = false;
    };
  }, [authenticated, connected]);

  return { updateAvailable };
}
