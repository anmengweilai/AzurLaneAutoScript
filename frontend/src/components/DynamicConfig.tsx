import { Button, Card, Checkbox, Form, Input, Select, Tag, Typography, message } from 'antd';
import { api, ApiError } from '@/services/api';
import { translate, type TranslationMap } from '@/i18n';

type SchemaField = Record<string, any>;

function isRecord(value: any): value is Record<string, any> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function optionLabel(i18n: TranslationMap | undefined, group: string, arg: string, option: string) {
  return translate(i18n, `${group}.${arg}.${option}`, option);
}

function ConfigField({
  field,
  group,
  arg,
  value,
  i18n,
  server,
  onClear,
}: {
  field: SchemaField;
  group: string;
  arg: string;
  value: any;
  i18n?: TranslationMap;
  server: string;
  onClear: () => void;
}) {
  const display = field.display;
  const disabled = display === 'disabled' || display === 'readonly';
  let options: any[] = field.option || [];
  const serverOptions = field[`option_${server}`];
  if (Array.isArray(serverOptions) && serverOptions.length) {
    options = serverOptions;
  }
  const labels = options.map((option: any) => ({
    value: option,
    label: optionLabel(i18n, group, arg, String(option)),
  }));
  const label = translate(i18n, `${group}.${arg}.name`, arg);
  const help = translate(i18n, `${group}.${arg}.help`, '');
  let control: React.ReactNode;

  if (field.type === 'storage') {
    return (
      <div className="arg-row">
        <div>
          <div className="arg-title">{label}</div>
          <div className="arg-help">This field is managed automatically by ALAS.</div>
        </div>
        <div className="arg-control">
          <pre className="storage-json">{JSON.stringify(value || {}, null, 2)}</pre>
          <Button
            block
            size="small"
            onClick={onClear}
          >
            Clear
          </Button>
        </div>
      </div>
    );
  }

  if (field.type === 'state' || field.type === 'lock') {
    const bold = (field.option_bold || []).includes(value);
    control = (
      <Tag color={bold ? 'purple' : 'default'} style={{ marginInlineEnd: 0 }}>
        {labels.find((item) => item.value === value)?.label || String(value)}
      </Tag>
    );
  } else if (field.type === 'checkbox') {
    control = <Checkbox disabled={disabled} />;
  } else if (field.type === 'textarea') {
    control = <Input.TextArea rows={4} disabled={disabled} />;
  } else if (field.type === 'select') {
    if (options.length === 1) {
      control = <Select options={labels} value={options[0]} disabled />;
    } else {
      control = <Select options={labels} allowClear={value === null} disabled={disabled} />;
    }
  } else {
    control = <Input disabled={disabled} placeholder={field.type === 'datetime' ? 'YYYY-MM-DD HH:mm:ss' : undefined} />;
  }

  return (
    <div className="arg-row">
      <div>
        <div className="arg-title">{label}</div>
        {help ? <div className="arg-help">{help}</div> : null}
      </div>
      <div className="arg-control" title={help}>
        <Form.Item
          noStyle
          name={[group, arg]}
          valuePropName={field.type === 'checkbox' ? 'checked' : 'value'}
          initialValue={value}
          rules={field.validate && field.validate !== 'datetime' ? [{ pattern: new RegExp(field.validate), message: 'Invalid format' }] : undefined}
        >
          {control}
        </Form.Item>
      </div>
    </div>
  );
}

export default function DynamicConfig({
  name,
  task,
  args,
  config,
  i18n,
  onSaved,
}: {
  name: string;
  task: string;
  args: Record<string, any>;
  config: Record<string, any>;
  i18n?: TranslationMap;
  onSaved: () => Promise<void> | void;
}) {
  const [form] = Form.useForm();
  const groups = Object.entries(args[task] || {}).filter(([, value]) => isRecord(value));
  const server = config?.Alas?.Emulator?.PackageName || 'cn';

  const save = async (group: string, arg: string, value: any) => {
    try {
      const result = await api<any>(`/api/v1/instances/${encodeURIComponent(name)}/config`, {
        method: 'PATCH',
        body: JSON.stringify({ changes: [{ path: `${task}.${group}.${arg}`, value }] }),
      });
      message.success('Saved');
      if (result.derived_changes?.length) {
        await onSaved();
      }
    } catch (error) {
      message.error(error instanceof ApiError ? error.message : String(error));
    }
  };

  return (
    <div>
      {translate(i18n, `Task.${task}.help`, '') ? (
        <Typography.Paragraph type="secondary" style={{ marginTop: 0 }}>
          {translate(i18n, `Task.${task}.help`)}
        </Typography.Paragraph>
      ) : null}

      <Form
        form={form}
        layout="vertical"
        onValuesChange={(changed) => {
          const group = Object.keys(changed)[0];
          const arg = Object.keys(changed[group])[0];
          save(group, arg, changed[group][arg]);
        }}
      >
        {groups.map(([group, fields]: [string, any]) => {
          const items = Object.entries(fields).filter(([arg, field]) => {
            if (!isRecord(field) || field.display === 'hide') return false;
            if (field.type === 'storage') return Object.keys(field.value || {}).length > 0;
            return true;
          });
          if (!items.length) return null;

          return (
            <Card
              key={group}
              type="inner"
              title={translate(i18n, `${group}._info.name`, group)}
              style={{ marginBottom: 16 }}
            >
              {translate(i18n, `${group}._info.help`, '') ? (
                <Typography.Paragraph type="secondary" style={{ marginTop: 0 }}>
                  {translate(i18n, `${group}._info.help`)}
                </Typography.Paragraph>
              ) : null}
              {items.map(([arg, field]: [string, any]) => (
                <ConfigField
                  key={arg}
                  field={field}
                  group={group}
                  arg={arg}
                  value={config?.[task]?.[group]?.[arg] ?? field.value}
                  i18n={i18n}
                  server={server}
                  onClear={() => save(group, arg, {})}
                />
              ))}
            </Card>
          );
        })}
      </Form>
    </div>
  );
}

