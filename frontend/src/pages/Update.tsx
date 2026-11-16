import { Alert, Button, Card, Descriptions, Space, Table, Tag } from 'antd';
import { LoadingOutlined } from '@ant-design/icons';
import { useCallback, useEffect, useState } from 'react';
import { api } from '@/services/api';
import { translate, type TranslationMap } from '@/i18n';

type Commit = { sha: string; author: string; date: string; message: string };
type UpdateStatus = {
  state: string;
  restart_enabled: boolean;
  branch: string;
  local?: Commit;
  upstream?: Commit;
  history: Commit[];
};

const BUSY_STATES = ['checking', 'waiting_instances', 'running', 'canceling'];
const CANCELABLE_STATES = ['waiting_instances', 'running'];

type StateMeta = {
  messageKey: string;
  fallback: string;
  alertType: 'success' | 'info' | 'warning' | 'error';
  loading: boolean;
};

const STATE_META: Record<string, StateMeta> = {
  up_to_date: { messageKey: 'Gui.Update.UpToDate', fallback: '已是最新版本', alertType: 'info', loading: false },
  update_available: { messageKey: 'Gui.Update.HaveUpdate', fallback: '有新版本可用', alertType: 'success', loading: false },
  checking: { messageKey: 'Gui.Update.UpdateChecking', fallback: '检查更新中', alertType: 'info', loading: true },
  failed: { messageKey: 'Gui.Update.UpdateFailed', fallback: '更新失败，可在./log/*_gui.txt中找到错误日志', alertType: 'error', loading: false },
  waiting_instances: { messageKey: 'Gui.Update.UpdateWait', fallback: '等待所有 Alas 完成当前任务', alertType: 'info', loading: true },
  running: { messageKey: 'Gui.Update.UpdateRun', fallback: '更新中', alertType: 'info', loading: true },
  reload_required: { messageKey: 'Gui.Update.UpdateSuccess', fallback: '更新成功，正在重启', alertType: 'success', loading: false },
  finished: { messageKey: 'Gui.Update.UpdateFinish', fallback: '更新成功，请手动重启', alertType: 'success', loading: false },
  canceling: { messageKey: 'Gui.Update.UpdateCancel', fallback: '取消更新，重启 Alas 中', alertType: 'warning', loading: true },
};

export default function Update() {
  const [status, setStatus] = useState<UpdateStatus>();
  const [i18n, setI18n] = useState<TranslationMap>();
  const [pendingAction, setPendingAction] = useState<'check' | 'run' | 'cancel'>();

  const tr = useCallback((key: string, fallback: string) => translate(i18n, key, fallback), [i18n]);

  const load = useCallback(async () => {
    setStatus(await api<UpdateStatus>('/api/v1/update/status'));
  }, []);

  const loadLocale = useCallback(async () => {
    const settings = await api<{ settings: { language: string } }>('/api/v1/settings');
    setI18n(await api<TranslationMap>(`/api/v1/i18n/${settings.settings.language}`));
  }, []);

  useEffect(() => {
    load();
    loadLocale().catch(() => setI18n({}));
    const timer = setInterval(load, 2000);
    return () => clearInterval(timer);
  }, [load, loadLocale]);

  const request = async (action: 'check' | 'run' | 'cancel') => {
    setPendingAction(action);
    try {
      await api(`/api/v1/update/${action}`, { method: 'POST' });
      await load();
    } finally {
      setPendingAction(undefined);
    }
  };

  const state = status?.state || 'loading';
  const meta = STATE_META[state] || {
    messageKey: '',
    fallback: 'Something went wrong, please contact develops',
    alertType: 'error' as const,
    loading: false,
  };

  const renderActions = () => {
    if (state === 'up_to_date') {
      return (
        <Button loading={pendingAction === 'check'} onClick={() => request('check')}>
          {tr('Gui.Button.CheckUpdate', '检查更新')}
        </Button>
      );
    }
    if (state === 'update_available') {
      return (
        <Button type="primary" loading={pendingAction === 'run'} onClick={() => request('run')}>
          {tr('Gui.Button.ClickToUpdate', '进行更新')}
        </Button>
      );
    }
    if (state === 'failed') {
      return (
        <Button type="primary" loading={pendingAction === 'run'} onClick={() => request('run')}>
          {tr('Gui.Button.RetryUpdate', '重试更新')}
        </Button>
      );
    }
    if (state === 'checking') {
      return <Button loading>{tr('Gui.Button.CheckUpdate', '检查更新')}</Button>;
    }
    if (CANCELABLE_STATES.includes(state)) {
      return (
        <Button
          danger
          disabled={state === 'running'}
          loading={pendingAction === 'cancel'}
          onClick={() => request('cancel')}
        >
          {tr('Gui.Button.CancelUpdate', '取消更新')}
        </Button>
      );
    }
    if (state === 'canceling') {
      return <Button danger disabled loading={pendingAction === 'cancel'}>{tr('Gui.Button.CancelUpdate', '取消更新')}</Button>;
    }
    return null;
  };

  const versionRows = [
    {
      key: 'local',
      label: tr('Gui.Update.Local', '本地'),
      ...(status?.local || {}),
    },
    {
      key: 'upstream',
      label: tr('Gui.Update.Upstream', '上游仓库'),
      ...(status?.upstream || {}),
    },
  ];
  const versionColumns = [
    { title: '', dataIndex: 'label', width: 120 },
    { title: 'SHA1', dataIndex: 'sha', width: 110 },
    { title: tr('Gui.Update.Author', '作者'), dataIndex: 'author', width: 160 },
    { title: tr('Gui.Update.Time', '提交时间'), dataIndex: 'date', width: 210 },
    { title: tr('Gui.Update.Message', '提交信息'), dataIndex: 'message' },
  ];

  return (
    <div className="alas-page">
      <div className="alas-page-header">
        <h2>{tr('Gui.MenuDevelop.Update', '更新器')}</h2>
        <Space wrap>{renderActions()}</Space>
      </div>

      <Space direction="vertical" size={16} style={{ width: '100%' }}>
        {status && !status.restart_enabled ? (
          <Alert
            type="warning"
            showIcon
            message={tr('Gui.Update.DisabledWarn', '更新模块未启用，你需要手动重启 Alas 进行更新')}
          />
        ) : null}
        <Card loading={!status} size="small" title="更新状态">
          <Alert
            type={meta.alertType}
            showIcon
            icon={meta.loading ? <LoadingOutlined /> : undefined}
            message={tr(meta.messageKey, meta.fallback)}
            description={state === 'unknown' ? `state: ${status?.state || ''}` : undefined}
          />
          <Descriptions
            size="small"
            style={{ marginTop: 16 }}
            column={{ xs: 1, sm: 2, md: 3 }}
            items={[
              { key: 'branch', label: '分支', children: <Tag color="blue">{status?.branch || '-'}</Tag> },
              { key: 'state', label: '状态', children: state === 'loading' ? '加载中' : tr(meta.messageKey, meta.fallback) },
              {
                key: 'restart',
                label: '自动重启',
                children: status ? (status.restart_enabled ? '已启用' : '未启用') : '-',
              },
            ]}
          />
        </Card>

        <Card size="small" title="版本对比">
          <Table
            size="small"
            rowKey="key"
            loading={!status}
            dataSource={versionRows}
            columns={versionColumns}
            pagination={false}
            scroll={{ x: 760 }}
            locale={{ emptyText: '无数据' }}
          />
        </Card>

        <Card size="small" title={tr('Gui.Update.DetailedHistory', '详细提交历史')}>
          <Table
            size="small"
            rowKey="sha"
            loading={!status}
            dataSource={status?.history || []}
            columns={versionColumns.filter(column => column.dataIndex !== 'label')}
            pagination={false}
            scroll={{ x: 700 }}
            locale={{ emptyText: '无数据' }}
          />
        </Card>
      </Space>
    </div>
  );
}
