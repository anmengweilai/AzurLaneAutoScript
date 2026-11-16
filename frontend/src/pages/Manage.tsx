import { Button, Card, message, Modal, Space, Table, Upload } from 'antd';
import { ImportOutlined, PlusOutlined } from '@ant-design/icons';
import { useCallback, useEffect, useState } from 'react';
import { api } from '@/services/api';

type Row = { name: string; mod: string; state: string };

export default function Manage() {
  const [rows, setRows] = useState<Row[]>([]);
  const [createOpen, setCreateOpen] = useState(false);

  const load = useCallback(async () => {
    const data = await api<{ items: Row[] }>('/api/v1/instances');
    setRows(data.items);
  }, []);
  useEffect(() => { load(); }, [load]);

  return (
    <div className="alas-page">
      <div className="alas-page-header">
        <h2>Manage</h2>
        <Space>
        <Button key="new" type="primary" icon={<PlusOutlined />} onClick={() => setCreateOpen(true)}>新建</Button>
        <Upload
          key="import"
          accept=".json"
          showUploadList={false}
          beforeUpload={(file) => {
            const reader = new FileReader();
            reader.onload = async () => {
              try {
                await api('/api/v1/instances/import', {
                  method: 'POST',
                  body: JSON.stringify({ filename: file.name, content: String(reader.result) }),
                });
                message.success('导入成功');
                load();
              } catch (error: any) {
                message.error(error.message);
              }
            };
            reader.readAsText(file);
            return false;
          }}
        >
          <Button icon={<ImportOutlined />}>导入</Button>
        </Upload>
        </Space>
      </div>
      <Card>
        <Table
          rowKey="name"
          dataSource={rows}
          pagination={false}
          columns={[
            { title: 'Name', dataIndex: 'name' },
            { title: 'Mod', dataIndex: 'mod' },
            {
              title: 'Actions',
              render: (_, record) => (
                <Space>
                  <Button size="small" onClick={() => window.open(`/api/v1/instances/${encodeURIComponent(record.name)}/config/export`)}>导出</Button>
                  <Button size="small" disabled>删除</Button>
                </Space>
              ),
            },
          ]}
        />
      </Card>
      <Modal open={createOpen} title="新建配置" onCancel={() => setCreateOpen(false)} footer={null}>
        请在“实例”页新建；该页面保留导出和导入。
      </Modal>
    </div>
  );
}
