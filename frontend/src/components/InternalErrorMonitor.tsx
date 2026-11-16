import { Button, Modal, Result } from 'antd';
import { Component, type ReactNode } from 'react';
import { ApiError } from '@/services/api';
import { INTERNAL_ERROR_EVENT, makeInternalErrorKey, reportInternalError, type InternalErrorDetail } from '@/services/internalError';

type InternalError = {
  key: number;
  message: string;
  stack?: string;
  html?: string;
  boundary: boolean;
};

type Props = {
  language: string;
  children: ReactNode;
};

type State = {
  error?: InternalError;
};

function getDevErrorOverlay() {
  return [...document.body.children].find((node): node is HTMLIFrameElement => (
    node.tagName === 'IFRAME'
    && !node.id
    && !node.className
    && getComputedStyle(node).position === 'fixed'
    && getComputedStyle(node).zIndex === '2147483647'
  )) || null;
}

function getStackTrace(error: unknown) {
  if (error instanceof ApiError) {
    const responseHtml = error.details?.tracebackHtml;
    if (typeof responseHtml === 'string' && responseHtml.trim()) return responseHtml;
    const responseTrace = error.details?.traceback;
    if (typeof responseTrace === 'string' && responseTrace.trim()) return responseTrace;
  }
  if (error instanceof Error && error.stack) return error.stack;
  if (error instanceof Error) return `${error.name}: ${error.message}`;
  return String(error);
}

export default class InternalErrorMonitor extends Component<Props, State> {
  state: State = {};
  private devOverlay?: HTMLIFrameElement;
  private devOverlayDisplay: string | null = null;
  private devOverlayObserver?: MutationObserver;
  private backendErrorSocket?: WebSocket;
  private backendErrorReconnectTimer?: number;
  private backendErrorCursor = -1;
  private reportedErrorKeys = new Set<string>();

  componentDidMount() {
    window.addEventListener('unhandledrejection', this.onUnhandledRejection);
    window.addEventListener('error', this.onError);
    window.addEventListener(INTERNAL_ERROR_EVENT, this.onReportedError);
    this.devOverlayObserver = new MutationObserver(() => {
      if (this.state.error) this.hideDevOverlay();
      else this.restoreDevOverlay();
    });
    this.devOverlayObserver.observe(document.body, { childList: true });
    this.connectBackendInternalErrors();
  }

  componentWillUnmount() {
    window.removeEventListener('unhandledrejection', this.onUnhandledRejection);
    window.removeEventListener('error', this.onError);
    window.removeEventListener(INTERNAL_ERROR_EVENT, this.onReportedError);
    window.clearTimeout(this.backendErrorReconnectTimer);
    this.backendErrorSocket?.close();
    this.devOverlayObserver?.disconnect();
    this.restoreDevOverlay();
  }

  onUnhandledRejection = (event: PromiseRejectionEvent) => {
    if (event.reason instanceof ApiError && event.reason.status === 401) return;
    event.preventDefault();
    const dedupeKey = event.reason instanceof ApiError && event.reason.details?.seq && event.reason.details?.timestamp
      ? makeInternalErrorKey(event.reason.details.seq, event.reason.details.timestamp)
      : undefined;
    this.showError(event.reason, 'Unhandled Rejection', false, undefined, undefined, dedupeKey);
  };

  onError = (event: ErrorEvent) => {
    if (event.target && event.target !== window) return;
    this.showError(event.error || `${event.message} (${event.filename}:${event.lineno})`, 'Runtime Error', false);
  };

  onReportedError = (event: Event) => {
    const detail = (event as CustomEvent<InternalErrorDetail>).detail;
    if (!detail) return;
    const error = new Error(detail.message);
    error.stack = detail.stack;
    this.showError(error, detail.source, false, detail.stack, detail.html, detail.key);
  };

  showError = (
    error: unknown,
    source: string,
    boundary: boolean,
    stackOverride?: string,
    htmlOverride?: string,
    dedupeKey?: string,
  ) => {
    if (dedupeKey && this.reportedErrorKeys.has(dedupeKey)) return;
    if (dedupeKey) this.reportedErrorKeys.add(dedupeKey);
    else if (error instanceof ApiError && error.details?.seq && error.details?.timestamp) {
      const key = makeInternalErrorKey(error.details.seq, error.details.timestamp);
      if (this.reportedErrorKeys.has(key)) return;
      this.reportedErrorKeys.add(key);
    }
    const stack = stackOverride || getStackTrace(error);
    const message = error instanceof Error ? error.message : String(error);
    const html = htmlOverride || ((error instanceof ApiError && typeof error.details?.tracebackHtml === 'string')
      ? error.details.tracebackHtml
      : undefined);

    console.error(`Internal Server Error [${source}]\n`, error);
    this.setState({
      error: {
        key: Date.now(),
        message,
        stack,
        html,
        boundary,
      },
    });
    this.hideDevOverlay();
  };

  private hideDevOverlay() {
    const overlay = getDevErrorOverlay();
    if (!overlay || overlay.style.display === 'none') return;
    this.devOverlay = overlay;
    this.devOverlayDisplay = overlay.style.display;
    overlay.style.display = 'none';
  }

  private restoreDevOverlay() {
    if (!this.devOverlay) return;
    if (this.devOverlayDisplay) this.devOverlay.style.display = this.devOverlayDisplay;
    else this.devOverlay.style.removeProperty('display');
    this.devOverlay = undefined;
    this.devOverlayDisplay = null;
  }

  private connectBackendInternalErrors() {
    if (this.backendErrorSocket || this.backendErrorReconnectTimer) return;

    const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const socket = new WebSocket(`${protocol}//${location.host}/api/v1/internal-errors/ws?cursor=${this.backendErrorCursor}`);
    this.backendErrorSocket = socket;

    socket.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.type !== 'internal-error') return;
        const item = data.event;
        this.backendErrorCursor = item.seq;
        reportInternalError({
          key: makeInternalErrorKey(item.seq, item.timestamp),
          source: item.source,
          message: item.message,
          stack: item.traceback,
          html: item.html,
        });
      } catch (error) {
        console.error('Failed to parse internal error event', error);
      }
    };

    socket.onclose = (event) => {
      if (this.backendErrorSocket !== socket) return;
      this.backendErrorSocket = undefined;
      if (event.code === 4401) return;
      this.backendErrorReconnectTimer = window.setTimeout(() => {
        this.backendErrorReconnectTimer = undefined;
        this.connectBackendInternalErrors();
      }, 2000);
    };
  };

  render() {
    const { language, children } = this.props;
    const { error } = this.state;
    const isZh = language.startsWith('zh');
    const title = isZh ? '应用发生内部错误' : 'An internal error occurred in the application';

    const modal = (
      <Modal
        open={Boolean(error)}
        title={title}
        width={960}
        maskClosable={false}
        onCancel={() => this.setState({ error: undefined }, () => this.restoreDevOverlay())}
        footer={
          <Button type="primary" onClick={() => this.setState({ error: undefined }, () => this.restoreDevOverlay())}>
            {isZh ? '关闭' : 'Close'}
          </Button>
        }
      >
        {error ? (
          <>
            <p>
              {isZh ? '错误信息：' : 'Message: '}
              <strong>{error.message}</strong>
            </p>
            {error.html ? (
              <div
                className="internal-error-rich"
                dangerouslySetInnerHTML={{ __html: error.html }}
              />
            ) : (
              <pre className="internal-error-trace">{error.stack}</pre>
            )}
          </>
        ) : null}
      </Modal>
    );

    if (!error?.boundary) {
      return <>{children}{modal}</>;
    }

    return (
      <>
        <Result
          status="error"
          title={isZh ? '页面渲染发生内部错误' : 'The page failed to render'}
          subTitle={error.message}
          extra={
            <Button type="primary" onClick={() => window.location.reload()}>
              {isZh ? '刷新页面' : 'Reload'}
            </Button>
          }
        />
        {modal}
      </>
    );
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    const stack = [error.stack, info.componentStack].filter(Boolean).join('\n\nReact Component Stack:\n');
    this.showError(error, 'React Render', true, stack);
  }
}
