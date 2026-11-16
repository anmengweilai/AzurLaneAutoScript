import { Button, Card, Form, Input, Typography } from 'antd';
import { LockOutlined } from '@ant-design/icons';
import { history } from '@umijs/max';
import { useState } from 'react';
import { api, ApiError } from '@/services/api';

export default function Login() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const submit = async (values: { password: string }) => {
    setLoading(true);
    setError('');
    try {
      await api('/api/v1/auth/login', { method: 'POST', body: JSON.stringify(values) });
      history.push('/instances');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', padding: 24 }}>
      <Card style={{ width: 400 }}>
        <Typography.Title level={3}>ALAS Control</Typography.Title>
        <Form layout="vertical" onFinish={submit}>
          <Form.Item name="password" label="密码 / Password" rules={[{ required: true }]}>
            <Input.Password prefix={<LockOutlined />} autoFocus />
          </Form.Item>
          <Button type="primary" htmlType="submit" loading={loading} block>
            登录 / Login
          </Button>
        </Form>
        {error ? <Typography.Text type="danger">{error}</Typography.Text> : null}
      </Card>
    </div>
  );
}
