import { Alert, Card, Descriptions, Typography } from 'antd';
import { useCallback, useEffect, useState } from 'react';
import { api } from '@/services/api';
import { translate, type TranslationMap } from '@/i18n';

type RemoteStatus = {
  state: string;
  entry_point: string | null;
  enabled: boolean;
  password_configured: boolean;
};

const CONFIGURE_URL = 'http://app.azurlane.cloud';

function getConfigureUrl(language?: string) {
  return language?.startsWith('zh') ? CONFIGURE_URL : `${CONFIGURE_URL}/en.html`;
}

function formatBoolean(
  value: boolean | undefined,
  tr: (key: string, fallback: string) => string,
) {
  if (value === undefined) return '-';
  return value ? tr('Gui.Remote.True', '已启用') : tr('Gui.Remote.False', '未启用');
}

function getRemoteState(
  status: RemoteStatus | undefined,
  tr: (key: string, fallback: string) => string,
) {
  if (!status) {
    return '-';
  }
  if (status.state === 'running' || status.state === 'connecting') {
    return tr('Gui.Remote.Running', '运行中');
  }
  if (status.enabled && status.password_configured) {
    return tr('Gui.Remote.NotRunning', '未运行，与服务器的连接断开或服务器离线');
  }
  return tr('Gui.Remote.NotEnable', '未启用，在 deploy.yaml 中设置 webui 密码并启用远程控制');
}

export default function Remote() {
  const [status, setStatus] = useState<RemoteStatus>();
  const [language, setLanguage] = useState<string>();
  const [i18n, setI18n] = useState<TranslationMap>();

  const tr = useCallback(
    (key: string, fallback: string) => translate(i18n, key, fallback),
    [i18n],
  );

  useEffect(() => {
    const load = () => api('/api/v1/remote-access/status').then(setStatus).catch(() => {});
    load();
    const timer = setInterval(load, 3000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    const loadLocale = () => api<{ settings: { language: string } }>('/api/v1/bootstrap')
      .then((bootstrap) => {
        setLanguage(bootstrap.settings.language);
        return api<TranslationMap>(`/api/v1/i18n/${bootstrap.settings.language}`);
      })
      .then(setI18n)
      .catch(() => {});

    loadLocale();
    window.addEventListener('alas-settings-changed', loadLocale);
    return () => window.removeEventListener('alas-settings-changed', loadLocale);
  }, []);

  return (
    <div className="alas-page">
      <div className="alas-page-header">
        <h2>{tr('Gui.MenuDevelop.Remote', 'Remote')}</h2>
      </div>
      <Card loading={!status || !i18n}>
        <Descriptions column={1} bordered>
          <Descriptions.Item label={tr('Gui.Remote.State', '状态')}>
            {getRemoteState(status, tr)}
          </Descriptions.Item>
          <Descriptions.Item label={tr('Gui.Remote.Enabled', '配置启用')}>
            {formatBoolean(status?.enabled, tr)}
          </Descriptions.Item>
          <Descriptions.Item label={tr('Gui.Remote.PasswordConfigured', '密码配置')}>
            {formatBoolean(status?.password_configured, tr)}
          </Descriptions.Item>
          <Descriptions.Item label={tr('Gui.Remote.EntryPoint', '入口地址')}>
            {status?.entry_point ? (
              <Typography.Link href={status.entry_point} target="_blank">{status.entry_point}</Typography.Link>
            ) : '-'}
          </Descriptions.Item>
        </Descriptions>
        {status && status.state !== 'running' && status.state !== 'connecting' ? (
          <Alert
            style={{ marginTop: 16 }}
            type="info"
            message={getRemoteState(status, tr)}
            description={
              <>
                {tr('Gui.Remote.ConfigureHint', '配置教程：')}
                <Typography.Link href={getConfigureUrl(language)} target="_blank">
                  {getConfigureUrl(language)}
                </Typography.Link>
              </>
            }
          />
        ) : (
          <Alert
            style={{ marginTop: 16 }}
            type="success"
            message={tr('Gui.Remote.Running', '运行中')}
            description={
              <>
                {tr('Gui.Remote.EntryPoint', '远程访问 url 地址:')}
                {status?.entry_point
                  ? <Typography.Link href={status.entry_point} target="_blank">{status.entry_point}</Typography.Link>
                  : tr('Gui.Remote.Loading', '加载中...')}
              </>
            }
          />
        )}

        {status?.state === 'ssh_missing' ? (
          <Alert
            style={{ marginTop: 16 }}
            type="warning"
            showIcon
            message={tr('Gui.Remote.SSHNotInstall', '系统中没有 ssh 工具，请参考教程下载或安装 ssh')}
          />
        ) : null}
      </Card>
    </div>
  );
}
