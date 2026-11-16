import { Alert, Card, Descriptions, Typography } from 'antd';
import { useEffect, useState } from 'react';
import { api } from '@/services/api';

export default function Remote() {
  const [status, setStatus] = useState<any>();

  useEffect(() => {
    const load = () => api('/api/v1/remote-access/status').then(setStatus).catch(() => {});
    load();
    const timer = setInterval(load, 3000);
    return () => clearInterval(timer);
  }, []);

  return (
    <div className="alas-page">
      <div className="alas-page-header"><h2>Remote</h2></div>
      <Card loading={!status}>
        <Descriptions column={1} bordered>
          <Descriptions.Item label="状态">{status?.state}</Descriptions.Item>
          <Descriptions.Item label="配置启用">{String(status?.enabled)}</Descriptions.Item>
          <Descriptions.Item label="密码配置">{String(status?.password_configured)}</Descriptions.Item>
          <Descriptions.Item label="入口地址">
            {status?.entry_point ? (
              <Typography.Link href={status.entry_point} target="_blank">{status.entry_point}</Typography.Link>
            ) : '-'}
          </Descriptions.Item>
        </Descriptions>
        <Alert
          style={{ marginTop: 16 }}
          type={status?.state === 'running' ? 'success' : 'info'}
          message="远程访问由 ALAS 的 SSH reverse tunnel 自动维持。"
          description="如未启动，请在 deploy.yaml 中启用 EnableRemoteAccess 并配置 Password、SSHServer。"
        />
      </Card>
    </div>
  );
}
