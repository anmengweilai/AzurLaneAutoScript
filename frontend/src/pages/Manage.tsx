import { Button, Card, Form, Input, message, Modal, Select, Space, Table, Upload } from 'antd';
import { ArrowLeftOutlined, ExportOutlined, ImportOutlined, PlusOutlined } from '@ant-design/icons';
import { history } from '@umijs/max';
import { useCallback, useEffect, useState } from 'react';
import { api, ApiError } from '@/services/api';
import { translate, type TranslationMap } from '@/i18n';
import type { Bootstrap } from '@/types';

type Row = { name: string; mod: string; state: string };

const INVALID_NAME_CHARS = new Set(['.', '\\', '/', ':', '*', '?', '"', "'", '<', '>', '|']);

function nextUnusedName(rows: Row[]) {
  const existing = new Set(rows.map(row => row.name));
  for (let index = 2; index < 100; index += 1) {
    if (!existing.has(`alas${index}`)) return `alas${index}`;
  }
  return '';
}

export default function Manage() {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [templates, setTemplates] = useState<string[]>([]);
  const [phoneCloud, setPhoneCloud] = useState<boolean>();
  const [i18n, setI18n] = useState<TranslationMap>();
  const [form] = Form.useForm();

  const tr = useCallback(
    (key: string, fallback: string) => translate(i18n, key, fallback),
    [i18n],
  );

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api<{ items: Row[] }>('/api/v1/instances');
      setRows(data.items);
    } finally {
      setLoading(false);
    }
  }, []);

  const loadLocale = useCallback(async () => {
    const bootstrap = await api<Bootstrap>('/api/v1/bootstrap');
    setPhoneCloud(Boolean(bootstrap.is_on_phone_cloud));
    setI18n(await api<TranslationMap>(`/api/v1/i18n/${bootstrap.settings.language}`));
  }, []);

  useEffect(() => {
    load().catch(error => message.error(error instanceof ApiError ? error.message : String(error)));
  }, [load]);

  useEffect(() => {
    loadLocale().catch(() => {});
    window.addEventListener('alas-settings-changed', loadLocale);
    return () => window.removeEventListener('alas-settings-changed', loadLocale);
  }, [loadLocale]);

  const openCreate = async () => {
    try {
      const data = await api<{ items: string[] }>('/api/v1/instances/templates');
      setTemplates(data.items);
      form.resetFields();
      form.setFieldsValue({
        name: nextUnusedName(rows),
        copy_from: data.items[0],
      });
      setCreateOpen(true);
    } catch (error) {
      message.error(error instanceof ApiError ? error.message : String(error));
    }
  };

  const validateName = (_rule: any, value: string) => {
    if (!value) return Promise.resolve();
    if (value.length > 64) {
      return Promise.reject(new Error(tr('Gui.AppManage.NameTooLong', '配置名称不能超过 64 个字符')));
    }
    if ([...value].some(char => INVALID_NAME_CHARS.has(char))) {
      return Promise.reject(new Error(tr('Gui.AppManage.InvalidChar', '配置文件名包含非法字符')));
    }
    if (value.toLowerCase().startsWith('template')) {
      return Promise.reject(new Error(tr('Gui.AppManage.InvalidPrefixTemplate', '配置文件名不能以 template 开头')));
    }
    if (rows.some(row => row.name === value)) {
      return Promise.reject(new Error(tr('Gui.AppManage.NameExist', '存在同名的配置文件')));
    }
    return Promise.resolve();
  };

  const createConfig = async (values: { name: string; copy_from: string }) => {
    try {
      await api('/api/v1/instances', {
        method: 'POST',
        body: JSON.stringify(values),
      });
      message.success(tr('Gui.AppManage.NewSuccess', '添加成功'));
      setCreateOpen(false);
      await load();
    } catch (error) {
      if (error instanceof ApiError && error.code === 'CONFLICT') {
        message.error(tr('Gui.AppManage.NameExist', '存在同名的配置文件'));
      } else {
        message.error(error instanceof ApiError ? error.message : String(error));
      }
    }
  };

  const importConfig = (file: File) => {
    if (file.size > 1024 * 1024) {
      message.error(tr('Gui.AppManage.FileTooLarge', '文件不能超过 1MB'));
      return false;
    }

    const reader = new FileReader();
    reader.onload = () => {
      Modal.confirm({
        title: tr('Gui.AppManage.Import', '导入'),
        content: tr('Gui.AppManage.OverrideWarning', '将会覆盖现有的配置文件'),
        okText: tr('Gui.AppManage.Import', '导入'),
        onOk: async () => {
          try {
            await api('/api/v1/instances/import', {
              method: 'POST',
              body: JSON.stringify({
                filename: file.name,
                content: String(reader.result || ''),
              }),
            });
            message.success(tr('Gui.AppManage.ImportSuccess', '导入成功'));
            await load();
          } catch (error) {
            message.error(error instanceof ApiError ? error.message : String(error));
          }
        },
      });
    };
    reader.readAsText(file);
    return false;
  };

  return (
    <div className="alas-page">
      <div className="alas-page-header">
        <h2>{tr('Gui.AppManage.PageTitle', 'Manage')}</h2>
        <Space>
          <Button
            type="primary"
            icon={<PlusOutlined />}
            disabled={phoneCloud === true}
            onClick={openCreate}
          >
            {tr('Gui.AppManage.New', '新建')}
          </Button>
          <Upload
            accept=".json"
            showUploadList={false}
            beforeUpload={importConfig}
          >
            <Button icon={<ImportOutlined />}>{tr('Gui.AppManage.Import', '导入')}</Button>
          </Upload>
          <Button icon={<ArrowLeftOutlined />} onClick={() => history.push('/home')}>
            {tr('Gui.AppManage.Back', '返回')}
          </Button>
        </Space>
      </div>
      <Card>
        <Table
          rowKey="name"
          loading={loading || !i18n}
          dataSource={rows}
          pagination={false}
          columns={[
            { title: tr('Gui.AppManage.Name', 'Name'), dataIndex: 'name' },
            { title: tr('Gui.AppManage.Mod', 'Mod'), dataIndex: 'mod' },
            {
              title: tr('Gui.AppManage.Actions', 'Actions'),
              render: (_, record) => (
                <Space>
                  <Button
                    size="small"
                    icon={<ExportOutlined />}
                    onClick={() => window.open(`/api/v1/instances/${encodeURIComponent(record.name)}/config/export`)}
                  >
                    {tr('Gui.AppManage.Export', '导出')}
                  </Button>
                  <Button size="small" disabled>{tr('Gui.AppManage.Delete', '删除')}</Button>
                </Space>
              ),
            },
          ]}
        />
      </Card>
      <Modal
        open={createOpen}
        title={tr('Gui.AppManage.TitleNew', '新建配置')}
        okText={tr('Gui.AppManage.New', '添加')}
        onCancel={() => setCreateOpen(false)}
        onOk={() => form.submit()}
      >
        <Form form={form} layout="vertical" onFinish={createConfig}>
          <Form.Item
            name="name"
            label={tr('Gui.AppManage.NewName', '新的配置文件名')}
            rules={[
              { required: true, message: tr('Gui.AppManage.NameRequired', '请输入配置名称') },
              { validator: validateName },
            ]}
          >
            <Input />
          </Form.Item>
          <Form.Item
            name="copy_from"
            label={tr('Gui.AppManage.CopyFrom', '从现有的配置中复制')}
            rules={[{ required: true }]}
          >
            <Select options={templates.map(value => ({ value, label: value }))} />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
