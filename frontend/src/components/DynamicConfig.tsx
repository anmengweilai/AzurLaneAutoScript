import { Button, Card, Checkbox, Form, Input, Select, Tag, Typography, message } from 'antd';
import { useEffect, useRef } from 'react';
import { api, ApiError } from '@/services/api';
import { translate, type TranslationMap } from '@/i18n';
import {
  isValidPattern,
  resolveServerOptions,
  toServer,
  type ConfigSchemaField,
  type ConfigServer,
} from '@/utils/configSchema';

type ConfigChange = { path: string; value: any };
type ConfigPatchResult = { derived_changes?: string[]; warnings?: string[] };

function isRecord(value: any): value is Record<string, any> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function optionLabel(i18n: TranslationMap | undefined, group: string, arg: string, option: string) {
  return translate(i18n, `${group}.${arg}.${option}`, option);
}

function validationMessage(i18n: TranslationMap | undefined, pattern: string) {
  const template = translate(i18n, 'Gui.Text.InvalidFeedBack', '');
  if (!template) return `Invalid format. Example: ${pattern}`;
  return template.includes('{0}') ? template.replace('{0}', pattern) : `${template} ${pattern}`;
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
  field: ConfigSchemaField;
  group: string;
  arg: string;
  value: any;
  i18n?: TranslationMap;
  server: ConfigServer;
  onClear: () => void;
}) {
  const display = field.display;
  const disabled = display === 'disabled' || display === 'readonly';
  const options = resolveServerOptions(field, server);
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
          <Button block size="small" onClick={onClear}>
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
    const isSingleBoldOption = options.length === 1 && (field.option_bold || []).includes(options[0]);
    if (isSingleBoldOption) {
      control = (
        <Tag color="purple" style={{ marginInlineEnd: 0 }}>
          {labels[0].label}
        </Tag>
      );
    } else {
      control = <Select options={labels} allowClear={value === null} disabled={disabled} />;
    }
  } else {
    control = (
      <Input
        disabled={disabled}
        placeholder={field.type === 'datetime' ? 'YYYY-MM-DD HH:mm:ss' : undefined}
      />
    );
  }

  return (
    <div className="arg-row">
      <div>
        <div className="arg-title">{label}</div>
        {help ? <div className="arg-help">{help}</div> : null}
      </div>
      <div className="arg-control" title={help}>
        <Form.Item
          className="arg-form-item"
          name={[group, arg]}
          valuePropName={field.type === 'checkbox' ? 'checked' : 'value'}
          initialValue={value}
          rules={field.validate && field.validate !== 'datetime' && typeof field.validate === 'string'
            ? [{
                validator: (_rule: any, fieldValue: any) => (
                  isValidPattern(field.validate, fieldValue)
                    ? Promise.resolve()
                    : Promise.reject(new Error(validationMessage(i18n, field.validate)))
                ),
              }]
            : undefined}
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
  toolPage,
  onSaved,
}: {
  name: string;
  task: string;
  args: Record<string, any>;
  config: Record<string, any>;
  i18n?: TranslationMap;
  toolPage?: boolean;
  onSaved: () => Promise<void> | void;
}) {
  const [form] = Form.useForm();
  const pendingChangesRef = useRef(new Map<string, any>());
  const saveTimerRef = useRef<number>();
  const groups = Object.entries(args[task] || {}).filter(([, value]) => isRecord(value));
  const server = toServer(config?.Alas?.Emulator?.PackageName);

  const saveChanges = async (changes: ConfigChange[]) => {
    return api<ConfigPatchResult>(`/api/v1/instances/${encodeURIComponent(name)}/config`, {
      method: 'PATCH',
      body: JSON.stringify({ changes }),
    });
  };

  const flushPendingChanges = async () => {
    if (saveTimerRef.current) {
      window.clearTimeout(saveTimerRef.current);
      saveTimerRef.current = undefined;
    }
    const changes = Array.from(pendingChangesRef.current, ([path, value]) => ({ path, value }));
    pendingChangesRef.current.clear();
    if (!changes.length) return;

    try {
      let result: ConfigPatchResult;
      try {
        result = await saveChanges(changes);
      } catch (error) {
        // 旧版会跳过非法字段并保存其余字段；批量被后端拒绝时逐条重放。
        if (changes.length === 1) throw error;
        const results = await Promise.all(changes.map(async (change) => {
          try {
            return await saveChanges([change]);
          } catch {
            return undefined;
          }
        }));
        if (results.every(item => item === undefined)) throw error;
        result = results.find(Boolean) as ConfigPatchResult;
      }
      message.success('Saved');
      if (result.derived_changes?.length || result.warnings?.length) {
        await onSaved();
      }
    } catch (error) {
      message.error(error instanceof ApiError ? error.message : String(error));
    }
  };

  useEffect(() => () => {
    if (saveTimerRef.current) {
      window.clearTimeout(saveTimerRef.current);
    }
    const changes = Array.from(pendingChangesRef.current, ([path, value]) => ({ path, value }));
    if (!changes.length) return;
    void saveChanges(changes).catch((error) => {
      message.error(error instanceof ApiError ? error.message : String(error));
    });
  }, [name]);

  const scheduleSave = (group: string, arg: string, value: any) => {
    pendingChangesRef.current.set(`${task}.${group}.${arg}`, value);
    if (saveTimerRef.current) {
      window.clearTimeout(saveTimerRef.current);
    }
    saveTimerRef.current = window.setTimeout(() => {
      saveTimerRef.current = undefined;
      void flushPendingChanges();
    }, 800);
  };

  const hiddenSingleEvent = (group: string, arg: string, field: any) => (
    task === 'GemsFarming'
    && group === 'Campaign'
    && arg === 'Event'
    && field.type === 'select'
    && resolveServerOptions(field, server).length === 1
  );

  const visibleGroups = groups.filter(([group, fields]) => {
    if (toolPage && group === 'Storage') return false;
    return Object.entries(fields as Record<string, any>).some(([arg, field]) => {
      if (!isRecord(field) || field.display === 'hide') return false;
      if (field.type === 'storage') return Object.keys(field.value || {}).length > 0;
      return !hiddenSingleEvent(group, arg, field);
    });
  });

  return (
    <div>
      {translate(i18n, `Task.${task}.help`, '') ? (
        <Typography.Paragraph type="secondary" style={{ marginTop: 0 }}>
          {translate(i18n, `Task.${task}.help`)}
        </Typography.Paragraph>
      ) : null}

      {visibleGroups.length > 1 ? (
        <div className="config-nav" aria-label="配置组导航">
          {visibleGroups.map(([group]) => (
            <Button
              key={group}
              size="small"
              onClick={() => {
                document.getElementById(`config-group-${group}`)?.scrollIntoView({
                  behavior: 'smooth',
                  block: 'start',
                });
              }}
            >
              {translate(i18n, `${group}._info.name`, group)}
            </Button>
          ))}
        </div>
      ) : null}

      <Form
        form={form}
        layout="vertical"
        onValuesChange={(changed) => {
          const group = Object.keys(changed)[0];
          const arg = Object.keys(changed[group])[0];
          scheduleSave(group, arg, changed[group][arg]);
        }}
      >
        {groups.map(([group, fields]: [string, any]) => {
          const items = Object.entries(fields).filter(([arg, field]) => {
            if (!isRecord(field) || field.display === 'hide') return false;
            if (field.type === 'storage') return Object.keys(field.value || {}).length > 0;
            return !hiddenSingleEvent(group, arg, field);
          });
          if (!items.length) return null;

          return (
            <Card
              key={group}
              id={`config-group-${group}`}
              type="inner"
              className="config-group-card"
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
                  onClear={() => scheduleSave(group, arg, {})}
                />
              ))}
            </Card>
          );
        })}
      </Form>
    </div>
  );
}
