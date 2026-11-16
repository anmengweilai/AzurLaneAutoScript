import { Button, Card, Spin, message } from 'antd';
import { useParams } from '@umijs/max';
import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent } from 'react';
import { useLocalStorageState, useSize } from 'ahooks';
import DynamicConfig from '@/components/DynamicConfig';
import LogsPanel from '@/components/LogsPanel';
import { api } from '@/services/api';
import { translate, type TranslationMap } from '@/i18n';
import type { Instance } from '@/types';

type TaskSummary = { name: string; next_run: string; enabled: boolean };
type Overview = { running: TaskSummary[]; pending: TaskSummary[]; waiting: TaskSummary[] };

const SCHEDULER_MIN_SECTION_HEIGHT = 128;
const SCHEDULER_DEFAULT_HEIGHTS = [180, 240, 300];
const SCHEDULER_HEIGHTS_STORAGE_PREFIX = 'alas.scheduler-heights.';
const SCHEDULER_EXTRA_HEIGHT_STORAGE_PREFIX = 'alas.scheduler-extra-height.';
const SCHEDULER_BODY_PADDING = 16;
const SCHEDULER_RESIZER_HEIGHT = 14;
const SCHEDULER_MAX_EXTRA_HEIGHT = 2000;

const SECTIONS = [
  { key: 'running', title: 'Running' },
  { key: 'pending', title: 'Pending' },
  { key: 'waiting', title: 'Waiting' },
] as const;

function parseSchedulerHeights(raw: string) {
  try {
    const values = JSON.parse(raw) as unknown;
    if (!Array.isArray(values) || values.length !== SCHEDULER_DEFAULT_HEIGHTS.length) {
      return SCHEDULER_DEFAULT_HEIGHTS;
    }
    return SCHEDULER_DEFAULT_HEIGHTS.map((_, index) => {
      const value = Number(values[index]);
      return Number.isFinite(value)
        ? Math.max(SCHEDULER_MIN_SECTION_HEIGHT, Math.round(value))
        : SCHEDULER_DEFAULT_HEIGHTS[index];
    });
  } catch {
    return SCHEDULER_DEFAULT_HEIGHTS;
  }
}

function readSchedulerHeights(values: unknown) {
  if (!Array.isArray(values) || values.length !== SCHEDULER_DEFAULT_HEIGHTS.length) {
    return SCHEDULER_DEFAULT_HEIGHTS;
  }

  return SCHEDULER_DEFAULT_HEIGHTS.map((_, index) => {
    const value = Number(values[index]);
    return Number.isFinite(value)
      ? Math.max(SCHEDULER_MIN_SECTION_HEIGHT, Math.round(value))
      : SCHEDULER_DEFAULT_HEIGHTS[index];
  });
}

function readSchedulerExtraHeight(value: unknown) {
  const height = Number(value);
  if (!Number.isFinite(height)) return 0;
  return Math.max(0, Math.min(SCHEDULER_MAX_EXTRA_HEIGHT, Math.round(height)));
}

function readSchedulerContentHeight(availableHeight: number) {
  return Math.max(
    0,
    availableHeight - SCHEDULER_BODY_PADDING - SCHEDULER_DEFAULT_HEIGHTS.length * SCHEDULER_RESIZER_HEIGHT,
  );
}

function normalizeSchedulerHeights(values: number[], availableHeight: number) {
  const contentHeight = readSchedulerContentHeight(availableHeight);
  const minHeight = SCHEDULER_MIN_SECTION_HEIGHT;
  const usable = Math.max(minHeight * values.length, contentHeight);
  const total = values.reduce((sum, height) => sum + height, 0);

  if (Math.abs(total - usable) < 1) {
    return values.map(height => Math.round(height));
  }

  const scaled = values.map(height => Math.max(minHeight, height / total * usable));
  const first = Math.round(Math.max(minHeight, scaled[0]));
  const second = Math.round(Math.max(minHeight, scaled[1]));
  const last = Math.round(Math.max(minHeight, usable - first - second));
  return [first, second, last];
}

export default function InstanceDetail(props?: { instanceName?: string }) {
  const params = useParams();
  const instanceName = props?.instanceName || decodeURIComponent(String(params.name || ''));
  const [instance, setInstance] = useState<Instance>();
  const [args, setArgs] = useState<Record<string, any>>();
  const [menu, setMenu] = useState<Record<string, any>>();
  const [i18n, setI18n] = useState<TranslationMap>();
  const [config, setConfig] = useState<Record<string, any>>();
  const [overview, setOverview] = useState<Overview>();
  const [revision, setRevision] = useState('');
  const [logAutoScroll, setLogAutoScroll] = useState(true);
  const [storedSchedulerHeights, setStoredSchedulerHeights] = useLocalStorageState<number[]>(
    SCHEDULER_HEIGHTS_STORAGE_PREFIX + instanceName,
    {
      defaultValue: SCHEDULER_DEFAULT_HEIGHTS,
      serializer: JSON.stringify,
      deserializer: parseSchedulerHeights,
    },
  );
  const [storedSchedulerExtraHeight, setStoredSchedulerExtraHeight] = useLocalStorageState<number>(
    SCHEDULER_EXTRA_HEIGHT_STORAGE_PREFIX + instanceName,
    {
      defaultValue: 0,
      serializer: JSON.stringify,
      deserializer: readSchedulerExtraHeight,
    },
  );
  const schedulerBodyRef = useRef<HTMLDivElement>(null);
  const schedulerBodySize = useSize(schedulerBodyRef);
  const schedulerBodyHeight = schedulerBodySize?.height || 0;

  const search = window.location.hash.split('?')[1] || '';
  const selectedTask = new URLSearchParams(search).get('task') || 'Overview';

  const loadInstance = useCallback(async () => {
    setInstance(await api<Instance>(`/api/v1/instances/${encodeURIComponent(instanceName)}`));
  }, [instanceName]);

  const loadOverview = useCallback(async () => {
    setOverview(await api<Overview>(`/api/v1/instances/${encodeURIComponent(instanceName)}/overview`));
  }, [instanceName]);

  const loadConfig = useCallback(async () => {
    const data = await api<any>(`/api/v1/instances/${encodeURIComponent(instanceName)}/config`);
    setConfig(data.config);
    setRevision(data.revision);
  }, [instanceName]);

  const persistedSchedulerHeights = useMemo(
    () => readSchedulerHeights(storedSchedulerHeights),
    [storedSchedulerHeights],
  );
  const schedulerHeights = useMemo(
    () => normalizeSchedulerHeights(persistedSchedulerHeights, schedulerBodyHeight || 0),
    [persistedSchedulerHeights, schedulerBodyHeight],
  );
  const schedulerExtraHeight = readSchedulerExtraHeight(storedSchedulerExtraHeight);
  const displaySchedulerExtraHeight = schedulerExtraHeight;
  const displaySchedulerHeights = [
    schedulerHeights[0],
    schedulerHeights[1],
    schedulerHeights[2] + displaySchedulerExtraHeight,
  ];

  const writeSchedulerRows = (heights: number[]) => {
    schedulerBodyRef.current?.style.setProperty(
      'grid-template-rows',
      heights
        .map((height, index) => (
          index < heights.length - 1
            ? `${height}px ${SCHEDULER_RESIZER_HEIGHT}px`
            : `${height}px`
        ))
        .join(' ') + ` ${SCHEDULER_RESIZER_HEIGHT}px`,
    );
  };

  useEffect(() => {
    let alive = true;
    const run = async () => {
      const detail = await api<Instance>(`/api/v1/instances/${encodeURIComponent(instanceName)}`);
      if (!alive) return;
      setInstance(detail);
      const mod = detail.mod || 'alas';
      const settings = await api<any>('/api/v1/settings');
      const [schemaData, menuData, configData, locale] = await Promise.all([
        api<any>(`/api/v1/config/schema/${mod}`),
        api<any>(`/api/v1/config/menu/${mod}`),
        api<any>(`/api/v1/instances/${encodeURIComponent(instanceName)}/config`),
        api<any>(`/api/v1/i18n/${settings.language}`),
      ]);
      if (!alive) return;
      setArgs(schemaData);
      setMenu(menuData);
      setConfig(configData.config);
      setRevision(configData.revision);
      setI18n(locale);
    };
    run().catch((error) => message.error(error.message));
    return () => { alive = false; };
  }, [instanceName]);

  useEffect(() => {
    loadInstance();
    if (selectedTask === 'Overview') loadOverview();
    const timer = window.setInterval(() => {
      loadInstance();
      if (selectedTask === 'Overview') loadOverview();
    }, 5000);
    return () => window.clearInterval(timer);
  }, [instanceName, selectedTask, loadInstance, loadOverview]);

  const control = async (action: 'start' | 'stop' | 'restart', task?: string) => {
    await api(`/api/v1/instances/${encodeURIComponent(instanceName)}/${action}`, {
      method: 'POST',
      body: JSON.stringify(task ? { task } : {}),
    });
    message.success('操作已提交');
    loadInstance();
  };

  const schedulerAction = (() => {
    switch (instance?.state) {
      case 'running':
        return { label: '停止', danger: true, disabled: false, action: 'stop' as const };
      case 'starting':
        return { label: '启动中', danger: false, disabled: true, action: 'start' as const };
      case 'stopping':
        return { label: '停止中', danger: true, disabled: true, action: 'stop' as const };
      case 'updating':
        return { label: '更新中', danger: false, disabled: true, action: 'start' as const };
      case 'failed':
        return { label: '启动', danger: false, disabled: false, action: 'start' as const };
      default:
        return { label: '启动', danger: false, disabled: false, action: 'start' as const };
    }
  })();

  const taskGroups = useMemo(() => Object.entries(args?.[selectedTask] || {}), [args, selectedTask]);

  const resizeSchedulerSections = (divider: number, delta: number) => {
    const next = [...displaySchedulerHeights];
    const top = next[divider] + delta;
    const maxTop = next[divider] + next[divider + 1] - SCHEDULER_MIN_SECTION_HEIGHT;
    next[divider] = Math.max(SCHEDULER_MIN_SECTION_HEIGHT, Math.min(top, maxTop));
    next[divider + 1] = next[divider] + next[divider + 1] - next[divider];
    setStoredSchedulerHeights([next[0], next[1], next[2] - displaySchedulerExtraHeight]);
  };

  const startSchedulerResize = (divider: number, event: ReactPointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    const startY = event.clientY;
    const initialHeights = [...displaySchedulerHeights];
    const currentExtraHeight = displaySchedulerExtraHeight;
    const handle = event.currentTarget;
    let latestHeights = initialHeights;
    let pendingFrame = 0;
    handle.setPointerCapture(event.pointerId);
    document.body.classList.add('scheduler-resizing');
    handle.classList.add('active');

    const onPointerMove = (moveEvent: PointerEvent) => {
      const delta = moveEvent.clientY - startY;
      const next = [...initialHeights];
      const top = initialHeights[divider] + delta;
      const maxTop = initialHeights[divider] + initialHeights[divider + 1] - SCHEDULER_MIN_SECTION_HEIGHT;
      next[divider] = Math.max(SCHEDULER_MIN_SECTION_HEIGHT, Math.min(top, maxTop));
      next[divider + 1] = initialHeights[divider] + initialHeights[divider + 1] - next[divider];
      latestHeights = next;
      if (pendingFrame) return;
      pendingFrame = window.requestAnimationFrame(() => {
        pendingFrame = 0;
        writeSchedulerRows(latestHeights);
      });
    };
    const onPointerUp = () => {
      if (pendingFrame) window.cancelAnimationFrame(pendingFrame);
      writeSchedulerRows(latestHeights);
      handle.releasePointerCapture(event.pointerId);
      handle.removeEventListener('pointermove', onPointerMove);
      handle.removeEventListener('pointerup', onPointerUp);
      handle.removeEventListener('pointercancel', onPointerUp);
      document.body.classList.remove('scheduler-resizing');
      handle.classList.remove('active');
      setStoredSchedulerHeights([
        latestHeights[0],
        latestHeights[1],
        latestHeights[2] - currentExtraHeight,
      ]);
    };

    handle.addEventListener('pointermove', onPointerMove);
    handle.addEventListener('pointerup', onPointerUp);
    handle.addEventListener('pointercancel', onPointerUp);
  };

  const startSchedulerBottomResize = (event: ReactPointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    const startY = event.clientY;
    const initialExtraHeight = displaySchedulerExtraHeight;
    const initialBaseHeights = [...schedulerHeights];
    const handle = event.currentTarget;
    let latestExtraHeight = initialExtraHeight;
    let pendingFrame = 0;
    handle.setPointerCapture(event.pointerId);
    document.body.classList.add('scheduler-resizing');
    handle.classList.add('active');

    const onPointerMove = (moveEvent: PointerEvent) => {
      const next = Math.max(
        0,
        Math.min(SCHEDULER_MAX_EXTRA_HEIGHT, initialExtraHeight + moveEvent.clientY - startY),
      );
      latestExtraHeight = next;
      if (pendingFrame) return;
      pendingFrame = window.requestAnimationFrame(() => {
        pendingFrame = 0;
        writeSchedulerRows([
          initialBaseHeights[0],
          initialBaseHeights[1],
          initialBaseHeights[2] + latestExtraHeight,
        ]);
      });
    };
    const onPointerUp = () => {
      if (pendingFrame) window.cancelAnimationFrame(pendingFrame);
      writeSchedulerRows([
        initialBaseHeights[0],
        initialBaseHeights[1],
        initialBaseHeights[2] + latestExtraHeight,
      ]);
      handle.releasePointerCapture(event.pointerId);
      handle.removeEventListener('pointermove', onPointerMove);
      handle.removeEventListener('pointerup', onPointerUp);
      handle.removeEventListener('pointercancel', onPointerUp);
      document.body.classList.remove('scheduler-resizing');
      handle.classList.remove('active');
      setStoredSchedulerExtraHeight(latestExtraHeight);
    };

    handle.addEventListener('pointermove', onPointerMove);
    handle.addEventListener('pointerup', onPointerUp);
    handle.addEventListener('pointercancel', onPointerUp);
  };

  const resizeSchedulerWithKeyboard = (divider: number, event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      resizeSchedulerSections(divider, -16);
    } else if (event.key === 'ArrowDown') {
      event.preventDefault();
      resizeSchedulerSections(divider, 16);
    }
  };

  const resizeSchedulerBottomWithKeyboard = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    const offset = event.key === 'ArrowUp' ? -32 : event.key === 'ArrowDown' ? 32 : 0;
    if (!offset) return;
    event.preventDefault();
    setStoredSchedulerExtraHeight(
      Math.max(0, Math.min(SCHEDULER_MAX_EXTRA_HEIGHT, displaySchedulerExtraHeight + offset)),
    );
  };

  if (!instance || !args || !menu || !config) {
    return <Spin style={{ display: 'grid', placeItems: 'center', minHeight: 260 }} />;
  }

  return (
    <div className="alas-page">
      {selectedTask === 'Overview' ? (
        <div className="overview">
          <Card
            size="small"
            className="scheduler"
            title={translate(i18n, 'Gui.Overview.Scheduler', 'Scheduler')}
            extra={
              <Button
	                className="scheduler-extra"
                type={schedulerAction.danger ? 'default' : 'primary'}
                danger={schedulerAction.danger}
                disabled={schedulerAction.disabled}
                onClick={() => control(schedulerAction.action)}
              >
                {schedulerAction.label}
              </Button>
            }
          >
	            <div
	              ref={schedulerBodyRef}
	              className="scheduler-body"
	              style={{
	                gridTemplateRows: displaySchedulerHeights
	                  .map((height, index) => (
	                    index < displaySchedulerHeights.length - 1
	                      ? `${height}px ${SCHEDULER_RESIZER_HEIGHT}px`
	                      : `${height}px`
	                  ))
	                  .join(' ') + ` ${SCHEDULER_RESIZER_HEIGHT}px`,
	              }}
	            >
	              {SECTIONS.map((section, index) => (
	                <Fragment key={section.key}>
	                  <Card
	                    type="inner"
	                    size="small"
	                    className="scheduler-section"
	                    style={{
	                      height: '100%',
	                      minHeight: SCHEDULER_MIN_SECTION_HEIGHT,
	                    }}
	                    title={translate(i18n, `Gui.Overview.${section.title}`, section.title)}
	                  >
	                    {(overview?.[section.key] || []).length ? (
	                      (overview?.[section.key] || []).map((task) => (
	                        <div key={task.name} className="task-card">
	                          <div className="task-card-main">
	                            <div className="task-card-name">{translate(i18n, `Task.${task.name}.name`, task.name)}</div>
	                            <div className="task-card-time">{task.next_run}</div>
	                          </div>
	                          <Button
	                            size="small"
	                            onClick={() => { window.location.hash = `#/instances/${encodeURIComponent(instanceName)}?task=${encodeURIComponent(task.name)}`; }}
	                          >
	                            {translate(i18n, 'Gui.Button.Setting', '设置')}
	                          </Button>
	                        </div>
	                      ))
	                    ) : (
	                      <div className="task-empty">{translate(i18n, 'Gui.Overview.NoTask', 'No task')}</div>
	                    )}
	                  </Card>
	                  {index < SECTIONS.length - 1 && (
	                    <div
		                      className="scheduler-resizer"
	                      role="separator"
	                      aria-orientation="horizontal"
	                      aria-label="调整调度器分区高度"
	                      tabIndex={0}
	                      onPointerDown={(event) => {
	                        startSchedulerResize(index, event);
	                      }}
	                      onKeyDown={(event) => resizeSchedulerWithKeyboard(index, event)}
	                    />
	                  )}
	                </Fragment>
	              ))}
              <div
                className="scheduler-resizer"
                role="separator"
                aria-orientation="horizontal"
                aria-label="调整等待中卡片高度"
                aria-valuemin={0}
                aria-valuemax={SCHEDULER_MAX_EXTRA_HEIGHT}
                aria-valuenow={displaySchedulerExtraHeight}
                tabIndex={0}
                onPointerDown={(event) => {
                  startSchedulerBottomResize(event);
                }}
                onKeyDown={resizeSchedulerBottomWithKeyboard}
              />
	            </div>
          </Card>
          <Card
            size="small"
            className="overview-log"
            title={translate(i18n, 'Gui.Overview.Log', 'Log')}
            extra={
              <Button
                type={logAutoScroll ? 'primary' : 'default'}
                onClick={() => setLogAutoScroll(!logAutoScroll)}
              >
                {`自动滚动 ${logAutoScroll ? '开' : '关'}`}
              </Button>
            }
          >
            <LogsPanel
              fill
              name={instanceName}
              showControls={false}
              autoScroll={logAutoScroll}
              onAutoScrollChange={setLogAutoScroll}
            />
          </Card>
        </div>
      ) : taskGroups.length ? (
        <div className="config-groups">
          <div className="config-groups-inner">
            <Card
              size="small"
              className="action-card"
              title={translate(i18n, `Task.${selectedTask}.name`, selectedTask)}
              extra={
                <Button
	                  className="scheduler-extra"
                  type={schedulerAction.danger ? 'default' : 'primary'}
                  danger={schedulerAction.danger}
                  disabled={schedulerAction.disabled}
                  onClick={() => control(schedulerAction.action, selectedTask)}
                >
                  {schedulerAction.label}
                </Button>
              }
            >
              <DynamicConfig
                name={instanceName}
                key={`${instanceName}:${selectedTask}:${revision}`}
                task={selectedTask}
                args={args}
                config={config}
                i18n={i18n}
                onSaved={loadConfig}
              />
            </Card>
            <Card size="small" title={translate(i18n, 'Gui.Overview.Log', 'Log')}>
              <LogsPanel name={instanceName} />
            </Card>
          </div>
        </div>
      ) : (
        <Card size="small">
          This task does not expose configurable fields.
        </Card>
      )}
    </div>
  );
}
