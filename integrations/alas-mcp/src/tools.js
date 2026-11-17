/**
 * Model-facing tools for the Alas Control API.
 *
 * Four tools cover the whole surface: instance lifecycle, configuration,
 * log streaming, and service/system state. Each tool takes an `action`
 * instead of exposing ~25 near-identical endpoints, which keeps the tool
 * list small enough to stay in context.
 */

import { z } from 'zod';
import { AlasError } from './client.js';

const INSTANCE_ACTIONS = ['list', 'get', 'start', 'stop', 'restart', 'overview', 'create', 'templates'];
const CONFIG_ACTIONS = ['get', 'patch', 'validate', 'export', 'schema', 'menu', 'i18n'];
const SYSTEM_ACTIONS = [
  'health',
  'version',
  'runtime',
  'bootstrap',
  'settings',
  'update_settings',
  'update_status',
  'update_check',
  'update_run',
  'update_cancel',
  'remote_access',
];

function text(payload) {
  return { content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }] };
}

function failure(error) {
  if (error instanceof AlasError) {
    return {
      isError: true,
      content: [{ type: 'text', text: JSON.stringify(error.toJSON(), null, 2) }],
    };
  }
  return {
    isError: true,
    content: [{ type: 'text', text: `${error?.message ?? error}` }],
  };
}

/** Trim the config payload to the requested paths so a read does not flood context. */
function pickPaths(config, paths) {
  if (!Array.isArray(paths) || paths.length === 0) {
    return config;
  }
  const result = {};
  for (const path of paths) {
    let cursor = config;
    let found = true;
    for (const key of String(path).split('.')) {
      if (cursor && typeof cursor === 'object' && key in cursor) {
        cursor = cursor[key];
      } else {
        found = false;
        break;
      }
    }
    result[path] = found ? cursor : null;
  }
  return result;
}

export function registerAlasTools(server, client) {
  server.registerTool(
    'alas_instances',
    {
      title: 'Alas instances',
      description:
        'Inspect and control Alas instances (one instance is one game account config). ' +
        '`list` shows every instance with state and pid; `start`/`stop`/`restart` change the running scheduler; ' +
        "`overview` returns the scheduler's next-run plan for one instance.",
      inputSchema: {
        action: z.enum(INSTANCE_ACTIONS).describe('What to do.'),
        name: z.string().min(1).optional().describe('Instance name. Required for every action except list, templates, create.'),
        task: z
          .string()
          .min(1)
          .optional()
          .describe('Task to run instead of the instance default mod (start/restart only).'),
        copy_from: z.string().min(1).optional().describe('Template or existing instance to copy (create only).'),
      },
    },
    async ({ action, name, task, copy_from }) => {
      try {
        if (action === 'list') {
          return text(await client.listInstances());
        }
        if (action === 'templates') {
          return text(await client.instanceTemplates());
        }
        if (action === 'create') {
          if (!name || !copy_from) {
            return failure(new Error('create requires both name and copy_from'));
          }
          return text(await client.createInstance(name, copy_from));
        }
        if (!name) {
          return failure(new Error(`${action} requires an instance name`));
        }
        switch (action) {
          case 'get':
            return text(await client.getInstance(name));
          case 'start':
            return text(await client.startInstance(name, task));
          case 'stop':
            return text(await client.stopInstance(name));
          case 'restart':
            return text(await client.restartInstance(name, task));
          case 'overview':
            return text(await client.instanceOverview(name));
          default:
            return failure(new Error(`Unknown action: ${action}`));
        }
      } catch (error) {
        return failure(error);
      }
    },
  );

  server.registerTool(
    'alas_config',
    {
      title: 'Alas configuration',
      description:
        'Read and edit an instance configuration. `patch` validates and saves in one call; ' +
        'pass `dry_run` to validate without writing. Config paths are dotted keys such as ' +
        '`Scheduler.ServerUpdate` — use `schema`/`menu` to discover valid ones. ' +
        'Saving while an instance runs applies on the next scheduler reload.',
      inputSchema: {
        action: z.enum(CONFIG_ACTIONS).describe('What to do.'),
        name: z.string().min(1).optional().describe('Instance name. Required for get, patch, validate, export.'),
        paths: z
          .array(z.string())
          .optional()
          .describe('With action=get, return only these dotted config paths instead of the whole file.'),
        changes: z
          .array(
            z.object({
              path: z.string().min(1).describe('Dotted config path, e.g. Scheduler.ServerUpdate.'),
              value: z.unknown().describe('New value; strings are coerced to the field type.'),
            }),
          )
          .optional()
          .describe('With action=patch/validate, the fields to write.'),
        dry_run: z.boolean().optional().describe('With action=patch, validate without saving.'),
        mod: z.string().min(1).optional().describe('Config module for schema/menu, default "alas".'),
        locale: z.string().min(1).optional().describe('Locale for action=i18n, default "zh-CN".'),
      },
    },
    async ({ action, name, paths, changes, dry_run, mod, locale }) => {
      try {
        switch (action) {
          case 'get': {
            if (!name) {
              return failure(new Error('get requires an instance name'));
            }
            const config = await client.getConfig(name);
            return text(pickPaths(config, paths));
          }
          case 'patch': {
            if (!name) {
              return failure(new Error('patch requires an instance name'));
            }
            if (!changes?.length) {
              return failure(new Error('patch requires at least one change'));
            }
            return text(await client.patchConfig(name, changes, { dryRun: Boolean(dry_run) }));
          }
          case 'validate': {
            if (!name) {
              return failure(new Error('validate requires an instance name'));
            }
            if (!changes?.length) {
              return failure(new Error('validate requires at least one change'));
            }
            return text(await client.validateConfig(name, changes));
          }
          case 'export': {
            if (!name) {
              return failure(new Error('export requires an instance name'));
            }
            return text(await client.exportConfig(name));
          }
          case 'schema':
            return text(await client.configSchema(mod || 'alas'));
          case 'menu':
            return text(await client.configMenu(mod || 'alas'));
          case 'i18n':
            return text(await client.i18n(locale || 'zh-CN'));
          default:
            return failure(new Error(`Unknown action: ${action}`));
        }
      } catch (error) {
        return failure(error);
      }
    },
  );

  server.registerTool(
    'alas_logs',
    {
      title: 'Alas logs',
      description:
        'Read an instance log window from the in-memory ring buffer (latest 1000 lines). ' +
        'Without `cursor` it returns the newest `limit` lines and then keeps listening briefly for live output. ' +
        'Pass the returned `cursor` back to fetch only newer lines.',
      inputSchema: {
        name: z.string().min(1).describe('Instance name.'),
        limit: z.number().int().min(1).max(500).optional().describe('Maximum events to return, default 80.'),
        cursor: z.number().int().min(0).optional().describe('Return events after this sequence number.'),
        wait_ms: z
          .number()
          .int()
          .min(200)
          .max(15000)
          .optional()
          .describe('How long to keep listening for live output after the buffer is drained, default 2000.'),
      },
    },
    async ({ name, limit, cursor, wait_ms }) => {
      try {
        return text(await client.logs(name, { limit: limit ?? 80, cursor: cursor ?? null, waitMs: wait_ms ?? 2000 }));
      } catch (error) {
        return failure(error);
      }
    },
  );

  server.registerTool(
    'alas_system',
    {
      title: 'Alas service',
      description:
        'Service-level state: `health`, `version`, `runtime` (python/alas versions), `bootstrap` (auth state and UI settings), ' +
        '`settings` / `update_settings` (language, theme), `remote_access`, and the updater actions ' +
        '`update_status` / `update_check` / `update_run` / `update_cancel`. Update actions are asynchronous; ' +
        'poll `update_status` for progress.',
      inputSchema: {
        action: z.enum(SYSTEM_ACTIONS).describe('What to do.'),
        settings: z
          .record(z.any())
          .optional()
          .describe('With action=update_settings, the fields to change, e.g. { "language": "en-US", "theme": "dark" }.'),
      },
    },
    async ({ action, settings }) => {
      try {
        switch (action) {
          case 'health':
            return text(await client.health());
          case 'version':
            return text(await client.version());
          case 'runtime':
            return text(await client.runtime());
          case 'bootstrap':
            return text(await client.bootstrap());
          case 'settings':
            return text(await client.settings());
          case 'update_settings':
            if (!settings || Object.keys(settings).length === 0) {
              return failure(new Error('update_settings requires a settings object'));
            }
            return text(await client.updateSettings(settings));
          case 'update_status':
            return text(await client.updateStatus());
          case 'update_check':
            return text(await client.updateCheck());
          case 'update_run':
            return text(await client.updateRun());
          case 'update_cancel':
            return text(await client.updateCancel());
          case 'remote_access':
            return text(await client.remoteAccess());
          default:
            return failure(new Error(`Unknown action: ${action}`));
        }
      } catch (error) {
        return failure(error);
      }
    },
  );
}