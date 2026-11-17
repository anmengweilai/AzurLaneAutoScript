import { Badge, Button, Card, Form, Input, Modal, Select, Space, Table, message } from 'antd';
import { PlusOutlined, ReloadOutlined } from '@ant-design/icons';
import { history } from '@umijs/max';
import { useCallback, useEffect, useState } from 'react';
import { api, ApiError } from '@/services/api';
import type { Instance } from '@/types';

const STATE_COLOR: Record<string, string> = {
  running: 'green',
  starting: 'blue',
  stopping: 'orange',
  failed: 'red',
  updating: 'purple',
  stopped: 'default',
};

export default function InstanceList({ title = 'Instances' }: { title?: string }) {
  const [items, setItems] = useState<Instance[]>([]);
  const [loading, setLoading] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [templates, setTemplates] = useState<string[]>([]);
  const [form] = Form.useForm();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api<{ items: Instance[] }>('/api/v1/instances');
      setItems(data.items);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    const timer = setInterval(load, 5000);
    return () => clearInterval(timer);
  }, [load]);

  const openCreate = async () => {
    const data = await api<{ items: string[] }>('/api/v1/instances/templates');
    setTemplates(data.items);
    form.setFieldsValue({ copy_from: data.items[0] });
    setCreateOpen(true);
  };

  return (
    <Card
      title={title}
      extra={(
        <Space>
          <Button icon={<ReloadOutlined />} onClick={load}>刷新</Button>
          <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>新建实例</Button>
        </Space>
      )}
    >
      <Table
        rowKey="name"
        loading={loading}
        dataSource={items}
        pagination={false}
        onRow={(record) => ({
          onClick: () => history.push(`/instances/${encodeURIComponent(record.name)}`),
          style: { cursor: 'pointer' },
        })}
        columns={[
          { title: '名称', dataIndex: 'name' },
          { title: 'Mod', dataIndex: 'mod', width: 120 },
          {
            title: '状态',
            dataIndex: 'state',
            width: 140,
            render: (state: string) => (
              <Badge status={STATE_COLOR[state] as any || 'default'} text={state} />
            ),
          },
          {
            title: 'PID',
            dataIndex: 'pid',
            width: 120,
            render: (value) => value || '-',
          },
          {
            title: '操作',
            width: 180,
            render: (_, record: Instance) => (
              <Space onClick={(event) => event.stopPropagation()}>
                <Button
                  size="small"
                  disabled={['running', 'starting', 'stopping', 'updating'].includes(record.state)}
                  onClick={() => api(
                    `/api/v1/instances/${encodeURIComponent(record.name)}/start`,
                    { method: 'POST' },
                  ).then(load)}
                >
                  启动
                </Button>
                <Button
                  size="small"
                  disabled={!['running', 'starting'].includes(record.state)}
                  onClick={() => api(
                    `/api/v1/instances/${encodeURIComponent(record.name)}/stop`,
                    { method: 'POST' },
                  ).then(load)}
                >
                  停止
                </Button>
              </Space>
            ),
          },
        ]}
      />
      <Modal
        open={createOpen}
        title="新建实例"
        onCancel={() => setCreateOpen(false)}
        onOk={() => form.submit()}
      >
        <Form
          form={form}
          layout="vertical"
          onFinish={async (values) => {
            try {
              await api('/api/v1/instances', {
                method: 'POST',
                body: JSON.stringify(values),
              });
              message.success('创建成功');
              setCreateOpen(false);
              load();
            } catch (error) {
              message.error(error instanceof ApiError ? error.message : String(error));
            }
          }}
        >
          <Form.Item name="name" label="实例名称" rules={[{ required: true }]}>
            <Input />
          </Form.Item>
          <Form.Item name="copy_from" label="复制来源" rules={[{ required: true }]}>
            <Select options={templates.map((value) => ({ value, label: value }))} />
          </Form.Item>
        </Form>
      </Modal>
    </Card>
  );
}
