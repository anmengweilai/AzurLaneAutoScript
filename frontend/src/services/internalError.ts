export const INTERNAL_ERROR_EVENT = 'alas-internal-error';

export type InternalErrorDetail = {
  key?: string;
  source: string;
  message: string;
  stack: string;
  html?: string;
};

export function makeInternalErrorKey(seq?: number, timestamp?: number | string) {
  return `${seq ?? Date.now()}:${timestamp ?? Date.now()}`;
}

export function reportInternalError(detail: InternalErrorDetail) {
  window.dispatchEvent(new CustomEvent(INTERNAL_ERROR_EVENT, { detail }));
}
