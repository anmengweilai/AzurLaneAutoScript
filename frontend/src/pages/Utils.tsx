import { Button, Card, Modal, Space, Typography, message } from 'antd';
import { api } from '@/services/api';

export default function Utils() {
  return (
    <div className="alas-page">
      <div className="alas-page-header"><h2>Utils</h2></div>
      <Card>
        <Space direction="vertical">
          <Typography.Text>以下工具对应旧 PyWebIO 的 Develop - Utils。</Typography.Text>
          <Space>
            <Button
              danger
              onClick={() => {
                Modal.confirm({
                  title: '强制重启 ALAS Control API',
                  content: '服务将在 3 秒后重启，浏览器可能短暂断开。',
                  onOk: async () => {
                    await api('/api/v1/system/force-restart', { method: 'POST' });
                    message.success('重启已请求');
                  },
                });
              }}
            >
              Force restart
            </Button>
            <Button
              onClick={() => { api('/api/v1/system/raise-exception', { method: 'POST' }); }}
            >
              Raise exception
            </Button>
          </Space>
        </Space>
      </Card>
    </div>
  );
}
