export type ConfigServer = 'cn' | 'en' | 'jp' | 'tw';
export type ConfigSchemaField = Record<string, any>;

const VALID_SERVERS = new Set<ConfigServer>(['cn', 'en', 'jp', 'tw']);

const VALID_PACKAGE: Record<string, ConfigServer> = {
  'com.bilibili.azurlane': 'cn',
  'com.YoStarEN.AzurLane': 'en',
  'com.YoStarJP.AzurLane': 'jp',
  'com.hkmanjuu.azurlane.gp': 'tw',
};

const VALID_CHANNEL_PACKAGE: Record<string, ConfigServer> = {
  'com.bilibili.blhx.huawei': 'cn',
  'com.bilibili.blhx.honor': 'cn',
  'com.bilibili.blhx.mi': 'cn',
  'com.tencent.tmgp.bilibili.blhx': 'cn',
  'com.bilibili.blhx.baidu': 'cn',
  'com.bilibili.blhx.qihoo': 'cn',
  'com.bilibili.blhx.nearme.gamecenter': 'cn',
  'com.bilibili.blhx.vivo': 'cn',
  'com.bilibili.blhx.mz': 'cn',
  'com.bilibili.blhx.dl': 'cn',
  'com.bilibili.blhx.lenovo': 'cn',
  'com.bilibili.blhx.uc': 'cn',
  'com.bilibili.blhx.mzw': 'cn',
  'com.yiwu.blhx.yx15': 'cn',
  'com.bilibili.blhx.m4399': 'cn',
  'com.bilibili.blhx.bilibiliMove': 'cn',
  'com.hkmanjuu.azurlane.gp.mc': 'tw',
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

export function toServer(packageOrServer: unknown): ConfigServer {
  if (typeof packageOrServer === 'string' && VALID_SERVERS.has(packageOrServer as ConfigServer)) {
    return packageOrServer as ConfigServer;
  }
  return VALID_PACKAGE[packageOrServer as string]
    || VALID_CHANNEL_PACKAGE[packageOrServer as string]
    || 'cn';
}

export function resolveServerOptions(field: ConfigSchemaField, server: ConfigServer) {
  const serverOptions = field[`option_${server}`];
  if (Array.isArray(serverOptions) && serverOptions.length > 0) {
    return serverOptions;
  }
  return Array.isArray(field.option) ? field.option : [];
}

export function isValidPattern(pattern: string, value: unknown) {
  try {
    return new RegExp(pattern).test(String(value));
  } catch {
    return false;
  }
}

export function isToolSection(menu: Record<string, unknown> | undefined, task: string) {
  return Boolean(Object.values(menu || {}).some((section) => (
    isRecord(section)
    && section.page === 'tool'
    && Array.isArray(section.tasks)
    && section.tasks.includes(task)
  )));
}
