import { useCallback, useEffect, useState } from 'react';
import { Alert, Button, Card, Col, Row, Segmented, Typography } from 'antd';
import { api } from '@/services/api';
import InstanceList from '@/components/InstanceList';
import type { Bootstrap } from '@/types';

const REPOSITORY_URL = 'https://github.com/LmeSzinc/AzurLaneAutoScript';

function isChinese(language?: string) {
  return Boolean(language?.startsWith('zh'));
}

export default function Home() {
  const [bootstrap, setBootstrap] = useState<Bootstrap>();

  const load = useCallback(async () => {
    const data = await api<Bootstrap>('/api/v1/bootstrap');
    setBootstrap(data);
  }, []);

  useEffect(() => {
    load().catch(() => {});
    window.addEventListener('alas-settings-changed', load);
    return () => window.removeEventListener('alas-settings-changed', load);
  }, [load]);

  const update = async (values: Record<string, any>) => {
    await api('/api/v1/settings', { method: 'PATCH', body: JSON.stringify(values) });
    await load();
    window.dispatchEvent(new CustomEvent('alas-settings-changed'));
  };

  const chinese = isChinese(bootstrap?.settings.language);

  return (
    <div className="alas-page">
      <Alert
        type="warning"
        showIcon
        message={
          chinese
            ? 'Alas 是一款免费开源软件，如果你在任何渠道付费购买了 Alas，请退款。'
            : 'Alas is free open-source software. If you paid for Alas from any channel, please request a refund.'
        }
        description={
          <>
            {chinese ? '项目仓库：' : 'Repository: '}
            <Typography.Link href={REPOSITORY_URL} target="_blank">{REPOSITORY_URL}</Typography.Link>
          </>
        }
      />
      <Row gutter={[16, 16]}>
        <Col span={24}>
          <InstanceList title="实例 / Instances" />
        </Col>
        <Col xs={24} md={12}>
          <Card title="语言 / Language">
            {bootstrap ? (
              <Segmented
                value={bootstrap.settings.language}
                options={bootstrap.settings.languages}
                onChange={(language) => update({ language })}
              />
            ) : null}
          </Card>
        </Col>
        <Col xs={24} md={12}>
          <Card title="主题 / Theme">
            <Segmented
              value={bootstrap?.settings.theme || 'default'}
              options={[{ label: 'Light', value: 'default' }, { label: 'Dark', value: 'dark' }]}
              onChange={(theme) => update({ theme })}
            />
          </Card>
        </Col>
        <Col span={24}>
          <Card title="运行环境">
            <RuntimeCard />
          </Card>
        </Col>
      </Row>
    </div>
  );
}

function RuntimeCard() {
  const [runtime, setRuntime] = useState<any>();
  useEffect(() => {
    api('/api/v1/system/runtime').then(setRuntime).catch(() => {});
  }, []);
  if (!runtime) return null;
  return (
    <>
      <Typography.Text>Python: {runtime.python}</Typography.Text>
      <br />
      <Typography.Text>Platform: {runtime.platform}</Typography.Text>
      <br />
      <Typography.Text>Web UI: {runtime.webui_host}:{runtime.webui_port}</Typography.Text>
      <Alert style={{ marginTop: 16 }} type="info" message="ALAS 会在后台继续运行，关闭浏览器不会停止任务。" />
      <Button
        style={{ marginTop: 16 }}
        danger
        onClick={async () => {
          await api('/api/v1/system/force-restart', { method: 'POST' });
        }}
      >
        强制重启 Control API
      </Button>
    </>
  );
}
