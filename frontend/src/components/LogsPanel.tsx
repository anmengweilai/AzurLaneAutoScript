import { Button, Space, Switch, Typography } from 'antd';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useSize } from 'ahooks';
import { history } from '@umijs/max';

type LogEvent = {
  seq: number;
  timestamp: string;
  level: string;
  format?: 'plain' | 'html';
  message: string;
  html?: string;
  lines?: number;
};

const LOG_LINE_HEIGHT = 16.32;
const LOG_OVERSCAN = 12;
const MAX_LOG_EVENTS = 200_000;
const LOG_FLUSH_INTERVAL = 32;

function logEventHeight(event: LogEvent) {
  return Math.max(1, event.lines || 1) * LOG_LINE_HEIGHT;
}

function formatLogContent(line: LogEvent) {
  return `[${line.timestamp}] [${line.level.toUpperCase()}] ${line.message}`
    .replace(/\r\n?|\n/g, '\\n')
    .replace(/\t/g, '\\t')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F\u2028\u2029]/g, (char) => {
      return `\\u${char.charCodeAt(0).toString(16).padStart(4, '0')}`;
    });
}

export default function LogsPanel({
  name,
  fill = false,
  showControls = true,
  autoScroll: controlledAutoScroll,
  onAutoScrollChange,
}: {
  name: string;
  fill?: boolean;
  showControls?: boolean;
  autoScroll?: boolean;
  onAutoScrollChange?: (value: boolean) => void;
}) {
  const [lines, setLines] = useState<LogEvent[]>([]);
  const [connected, setConnected] = useState(false);
  const [internalAutoScroll, setInternalAutoScroll] = useState(true);
  const cursor = useRef(0);
  const socket = useRef<WebSocket>();
  const container = useRef<HTMLDivElement>(null);
  const unmounted = useRef(false);
  const pendingEvents = useRef<LogEvent[]>([]);
  const flushTimer = useRef<number>();
  const autoScroll = controlledAutoScroll ?? internalAutoScroll;
  const [logRange, setLogRange] = useState({ start: 0, end: 0 });
  const logContainerSize = useSize(container);
  const logLineOffsets = useMemo(() => {
    let totalLines = 0;
    return lines.map((line) => {
      const offset = totalLines;
      totalLines += Math.max(1, line.lines || 1);
      return offset;
    });
  }, [lines]);
  const totalLogLines = useMemo(() => (
    logLineOffsets.length
      ? logLineOffsets[logLineOffsets.length - 1] + Math.max(1, lines[lines.length - 1].lines || 1)
      : 0
  ), [logLineOffsets, lines]);

  const setAutoScroll = (value: boolean) => {
    if (controlledAutoScroll === undefined) {
      setInternalAutoScroll(value);
    }
    onAutoScrollChange?.(value);
  };

  const syncLogRange = useCallback(() => {
    const element = container.current;
    if (!element) return;

    const visibleCount = Math.ceil(element.clientHeight / LOG_LINE_HEIGHT);
    const topLine = element.scrollTop / LOG_LINE_HEIGHT;
    let low = 0;
    let high = logLineOffsets.length - 1;
    while (low < high) {
      const middle = (low + high + 1) >> 1;
      if (logLineOffsets[middle] <= topLine) low = middle;
      else high = middle - 1;
    }
    const start = Math.max(0, low - LOG_OVERSCAN);
    const bottomLine = topLine + visibleCount + LOG_OVERSCAN;
    let end = start;
    let renderedLines = 0;
    while (end < lines.length && renderedLines < bottomLine - (logLineOffsets[start] || 0)) {
      renderedLines += Math.max(1, lines[end].lines || 1);
      end += 1;
    }

    setLogRange((current) => (
      current.start === start && current.end === end
        ? current
        : { start, end }
    ));
  }, [lines, logLineOffsets]);

  useLayoutEffect(() => {
    syncLogRange();
  }, [syncLogRange, logContainerSize?.height, logContainerSize?.width]);

  useLayoutEffect(() => {
    const element = container.current;
    if (!autoScroll || !lines.length || !element) return;
    element.scrollTop = totalLogLines * LOG_LINE_HEIGHT;
    syncLogRange();
  }, [autoScroll, lines, totalLogLines, syncLogRange]);

  useEffect(() => {
    unmounted.current = false;

    const connect = () => {
      if (unmounted.current) return;
      const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
      const ws = new WebSocket(`${protocol}//${location.host}/api/v1/instances/${encodeURIComponent(name)}/logs?cursor=${cursor.current}`);
      socket.current = ws;
      ws.onopen = () => setConnected(true);
      ws.onmessage = (event) => {
        const data = JSON.parse(event.data);
        if (data.type === 'heartbeat') return;
        cursor.current = data.seq;
        pendingEvents.current.push(data);
        if (!flushTimer.current) {
          flushTimer.current = window.setTimeout(() => {
            flushTimer.current = undefined;
            const incomingEvents = pendingEvents.current;
            pendingEvents.current = [];
            setLines((current) => {
              const nextLines = current.concat(incomingEvents);
              return nextLines.length > MAX_LOG_EVENTS
                ? nextLines.slice(-MAX_LOG_EVENTS)
                : nextLines;
            });
          }, LOG_FLUSH_INTERVAL);
        }
      };
      ws.onclose = (event) => {
        setConnected(false);
        if (event.code === 4401) {
          history.push('/login');
          return;
        }
        if (!unmounted.current) setTimeout(connect, 2000);
      };
      ws.onerror = () => ws.close();
    };

    connect();
    return () => {
      unmounted.current = true;
      socket.current?.close();
      if (flushTimer.current) {
        window.clearTimeout(flushTimer.current);
        flushTimer.current = undefined;
      }
    };
  }, [name]);

  const clearLogs = () => {
    pendingEvents.current = [];
    if (flushTimer.current) {
      window.clearTimeout(flushTimer.current);
      flushTimer.current = undefined;
    }
    setLines([]);
  };

  return (
    <div className={fill ? 'logs-panel-fill' : undefined}>
      {showControls && (
        <Space style={{ marginBottom: 12 }}>
          <Typography.Text type={connected ? 'success' : 'warning'}>{connected ? '已连接' : '连接中'}</Typography.Text>
          <Button size="small" onClick={clearLogs}>清空</Button>
          <Space align="center">
            <Typography.Text>自动滚动</Typography.Text>
            <Switch size="small" checked={autoScroll} onChange={setAutoScroll} />
          </Space>
        </Space>
      )}
      <div ref={container} className="control-log" role="log" aria-label="Instance logs" onScroll={syncLogRange}>
        <div className="virtual-log-spacer" style={{ height: totalLogLines * LOG_LINE_HEIGHT }}>
          <div
            className="virtual-log-window"
            style={{ top: (logLineOffsets[logRange.start] || 0) * LOG_LINE_HEIGHT }}
          >
            {lines.slice(logRange.start, logRange.end).map((line) => {
            const height = logEventHeight(line);
            const content = formatLogContent(line);
            return (
              line.format === 'html' && line.html ? (
                <div
                  key={line.seq}
                  className="virtual-log-row virtual-log-rich"
                  style={{ height }}
                  title={content}
                  dangerouslySetInnerHTML={{ __html: line.html }}
                />
              ) : (
                <div key={line.seq} className="virtual-log-row" style={{ height }} title={content}>
                  {content}
                </div>
              )
            );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
