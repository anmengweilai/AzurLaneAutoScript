import { Alert, Button, Card, Col, Row, Segmented, Typography } from 'antd';
import { useEffect, useState } from 'react';
import { api } from '@/services/api';
import type { Bootstrap } from '@/types';

export default function Home() {
  const [bootstrap, setBootstrap] = useState<Bootstrap>();

  const load = async () => setBootstrap(await api<Bootstrap>('/api/v1/bootstrap'));
  useEffect(() => { load(); }, []);

  const update = async (values: Record<string, any>) => {
    await api('/api/v1/settings', { method: 'PATCH', body: JSON.stringify(values) });
    await load();
    window.dispatchEvent(new CustomEvent('alas-settings-changed'));
  };

  return (
    <div className="alas-page">
      <Row gutter={[16, 16]}>
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
