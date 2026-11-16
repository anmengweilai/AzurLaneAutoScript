import { ConfigProvider, Spin, theme } from 'antd';
import zhCN from 'antd/locale/zh_CN';
import enUS from 'antd/locale/en_US';
import jaJP from 'antd/locale/ja_JP';
import zhTW from 'antd/locale/zh_TW';
import { Outlet, useLocation } from '@umijs/max';
import { useCallback, useEffect, useMemo, useState } from 'react';
import alasIcon from '@/assets/gui/icon/alas.svg';
import developIcon from '@/assets/gui/icon/develop.svg';
import runIcon from '@/assets/gui/icon/run.svg';
import settingIcon from '@/assets/gui/icon/setting.svg';
import InternalErrorMonitor from '@/components/InternalErrorMonitor';
import { api } from '@/services/api';
import { translate, type TranslationMap } from '@/i18n';
import type { Bootstrap, Instance } from '@/types';

const ANTD_LOCALES: Record<string, any> = {
  'zh-CN': zhCN,
  'zh-TW': zhTW,
  'en-US': enUS,
  'ja-JP': jaJP,
};

const DEVELOPMENT_MENU = [
  { label: 'Home', path: '/home' },
  { label: 'Update', path: '/update' },
  { label: 'Remote', path: '/remote' },
  { label: 'Utils', path: '/utils' },
];

const PAGE_TITLES: Record<string, string> = {
  '/home': 'Home',
  '/update': 'Update',
  '/remote': 'Remote',
  '/utils': 'Utils',
  '/manage': 'Manage',
};

type MenuLink = { task: string; label: string; path: string };

export default function BasicLayout() {
  const location = useLocation();
  const [bootstrap, setBootstrap] = useState<Bootstrap>();
  const [instances, setInstances] = useState<Instance[]>([]);
  const [menu, setMenu] = useState<Record<string, any>>();
  const [i18n, setI18n] = useState<TranslationMap>();
  const [loadError, setLoadError] = useState('');

  const path = location.pathname;
  const detailMatch = path.match(/^\/instances\/([^/]+)/);
  const selectedName = detailMatch ? decodeURIComponent(detailMatch[1]) : '';
  const params = new URLSearchParams(location.search);
  const selectedTask = params.get('task') || 'Overview';
  const selectedInstance = instances.find((item) => item.name === selectedName);

  const loadShell = useCallback(async () => {
    try {
      setLoadError('');
      const [boot, instanceItems] = await Promise.all([
        api<Bootstrap>('/api/v1/bootstrap'),
        api<{ items: Instance[] }>('/api/v1/instances'),
      ]);
      setBootstrap(boot);
      setInstances(instanceItems.items);
      try {
        setI18n(await api<TranslationMap>(`/api/v1/i18n/${boot.settings.language}`));
      } catch {
        setI18n({});
      }
      if (!boot.authenticated && path !== '/login') {
        window.location.hash = '#/login';
      }
    } catch (error: any) {
      setLoadError(error.message || String(error));
    }
  }, [path]);

  useEffect(() => {
    const dark = bootstrap?.settings.theme === 'dark';
    document.documentElement.classList.toggle('dark-alas', Boolean(dark));
  }, [bootstrap?.settings.theme]);

  useEffect(() => {
    loadShell();
    const timer = window.setInterval(loadShell, 5000);
    const listener = () => loadShell();
    window.addEventListener('alas-settings-changed', listener);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('alas-settings-changed', listener);
    };
  }, [loadShell]);

  useEffect(() => {
    if (!selectedInstance) {
      setMenu(undefined);
      return;
    }
    let alive = true;
    api<Record<string, any>>(`/api/v1/config/menu/${selectedInstance.mod || 'alas'}`)
      .then((data) => alive && setMenu(data))
      .catch(() => alive && setMenu({}));
    return () => {
      alive = false;
    };
  }, [selectedInstance]);

  useEffect(() => {
    if (bootstrap?.authenticated && path === '/login') {
      window.location.hash = '#/instances';
    }
  }, [bootstrap?.authenticated, path]);

  const menuLinks = useMemo<MenuLink[]>(() => {
    if (!selectedName || !menu) {
      return [];
    }
    return Object.entries(menu).flatMap(([sectionKey, section]: [string, any]) =>
      (section.tasks || []).map((task: string) => ({
        task,
        label: translate(i18n, `Task.${task}.name`, task),
        path: `/instances/${encodeURIComponent(selectedName)}?task=${encodeURIComponent(task)}`,
      })),
    );
  }, [menu, selectedName, i18n]);

  const activeAside = selectedName
    ? selectedName
    : PAGE_TITLES[path]
      ? path
      : '/home';

  const headerTitle = selectedName
    ? selectedTask === 'Overview'
      ? selectedName
      : translate(i18n, `Task.${selectedTask}.name`, selectedTask)
    : PAGE_TITLES[path]
      ? translate(i18n, {
        '/home': 'Gui.MenuDevelop.HomePage',
        '/update': 'Gui.MenuDevelop.Update',
        '/remote': 'Gui.MenuDevelop.Remote',
        '/utils': 'Gui.MenuDevelop.Utils',
        '/manage': 'Gui.AddAlas.Manage',
      }[path] || path, PAGE_TITLES[path])
      : 'Home';

  if (!bootstrap) {
    return (
      <div style={{ minHeight: '100dvh', display: 'grid', placeItems: 'center' }}>
        <Spin size="large" />
        {loadError ? <span style={{ marginLeft: 12 }}>{loadError}</span> : null}
      </div>
    );
  }

  const dark = bootstrap.settings.theme === 'dark';
  const headerStatus = (() => {
    switch (selectedInstance?.state) {
      case 'running':
      case 'starting':
        return { className: 'alas-status-border', key: 'Gui.Status.Running', fallback: 'Running' };
      case 'stopping':
      case 'stopped':
        return { className: 'alas-status-border alas-status-border-fill', key: 'Gui.Status.Inactive', fallback: 'Inactive' };
      case 'failed':
        return { className: 'alas-status-grow alas-status-warning', key: 'Gui.Status.Warning', fallback: 'Warning' };
      case 'updating':
        return { className: 'alas-status-grow alas-status-success', key: 'Gui.Status.Updating', fallback: 'Updating' };
      default:
        return { className: 'alas-status-border alas-status-border-fill', key: 'Gui.Status.Inactive', fallback: 'Inactive' };
    }
  })();

  return (
    <ConfigProvider
      locale={ANTD_LOCALES[bootstrap.settings.language] || enUS}
      theme={{
        algorithm: dark ? theme.darkAlgorithm : theme.defaultAlgorithm,
        cssVar: true,
        token: {
          colorPrimary: '#4e4c97',
          borderRadius: 6,
          fontSize: 14,
        },
      }}
    >
      <InternalErrorMonitor language={bootstrap.settings.language}>
        <main className="alas-root">
          <header className="alas-header">
          <div className="alas-header-icon"><img src={alasIcon} alt="Alas" /></div>
          <div className="alas-header-brand">Alas</div>
          <div className="alas-header-status">
            {selectedInstance ? (
              <>
                <span className={`alas-status-indicator ${headerStatus.className}`} aria-hidden="true" />
                <span className="alas-status-text">
                  {translate(i18n, headerStatus.key, headerStatus.fallback)}
                </span>
              </>
            ) : null}
          </div>
          <div className="alas-header-title"><h1>{headerTitle}</h1></div>
        </header>

        <div className="alas-contents">
          <nav className="alas-aside" aria-label="Primary">
            <button
              type="button"
              className={`aside-button ${activeAside === '/home' || DEVELOPMENT_MENU.some((item) => item.path === path) ? 'aside-button-active' : ''}`}
              onClick={() => { window.location.hash = '#/home'; }}
            >
              <span
                className="aside-icon"
                style={{
                  WebkitMaskImage: `url(${developIcon})`,
                  maskImage: `url(${developIcon})`,
                }}
              />
              {translate(i18n, 'Gui.Aside.Home', 'Home')}
            </button>

            {instances.map((instance) => (
              <button
                key={instance.name}
                type="button"
                className={`aside-button ${activeAside === instance.name ? 'aside-button-active' : ''}`}
                onClick={() => { window.location.hash = `#/instances/${encodeURIComponent(instance.name)}`; }}
              >
                <span
                  className="aside-icon"
                  style={{
                    WebkitMaskImage: `url(${runIcon})`,
                    maskImage: `url(${runIcon})`,
                  }}
                />
                {instance.name}
              </button>
            ))}

            <button
              type="button"
              className={`aside-button ${activeAside === '/manage' ? 'aside-button-active' : ''}`}
              onClick={() => { window.location.hash = '#/manage'; }}
            >
              <span
                className="aside-icon"
                style={{
                  WebkitMaskImage: `url(${settingIcon})`,
                  maskImage: `url(${settingIcon})`,
                }}
              />
              {translate(i18n, 'Gui.AddAlas.Manage', 'Manage')}
            </button>
          </nav>

          <nav className="alas-menu" aria-label="Sections">
            {selectedName ? (
              <>
                <button
                  type="button"
                  className={`menu-button ${selectedTask === 'Overview' ? 'menu-button-active' : ''}`}
                  onClick={() => { window.location.hash = `#/instances/${encodeURIComponent(selectedName)}`; }}
                >
                  {translate(i18n, 'Gui.MenuAlas.Overview', 'Overview')}
                </button>

                {Object.entries(menu || {}).map(([sectionKey, section]: [string, any]) => {
                  const label = sectionKey;
                  const tasks: MenuLink[] = (section.tasks || []).map((task: string) => ({
                    task,
	                    label: translate(i18n, `Task.${task}.name`, task),
                    path: `/instances/${encodeURIComponent(selectedName)}?task=${encodeURIComponent(task)}`,
                  }));

                  if (section.menu === 'collapse') {
                    return (
                      <details
                        key={sectionKey}
                        className="menu-group"
                        open={section.tasks?.includes(selectedTask)}
                      >
                        <summary>{translate(i18n, `Menu.${sectionKey}.name`, label)}</summary>
                        <div className="menu-group-body">
                          {tasks.map((task) => (
                            <button
                              key={task.task}
                              type="button"
                              className={`menu-button ${selectedTask === task.task ? 'menu-button-active' : ''}`}
                              onClick={() => { window.location.hash = `#${task.path}`; }}
                            >
                              {task.label}
                            </button>
                          ))}
                        </div>
                      </details>
                    );
                  }

                  return (
                    <div key={sectionKey}>
                      <div className="menu-section-title">{translate(i18n, `Menu.${sectionKey}.name`, label)}</div>
                      {tasks.map((task) => (
                        <button
                          key={task.task}
                          type="button"
                          className={`menu-button ${selectedTask === task.task ? 'menu-button-active' : ''}`}
                          onClick={() => { window.location.hash = `#${task.path}`; }}
                        >
                          {task.label}
                        </button>
                      ))}
                    </div>
                  );
                })}
              </>
            ) : (
              DEVELOPMENT_MENU.map((item) => (
                <button
                  key={item.path}
                  type="button"
                  className={`menu-button ${path === item.path ? 'menu-button-active' : ''}`}
                  onClick={() => { window.location.hash = `#${item.path}`; }}
                >
                  {translate(i18n, {
                    '/home': 'Gui.MenuDevelop.HomePage',
                    '/update': 'Gui.MenuDevelop.Update',
                    '/remote': 'Gui.MenuDevelop.Remote',
                    '/utils': 'Gui.MenuDevelop.Utils',
                  }[item.path] || item.label, item.label)}
                </button>
              ))
            )}
          </nav>

          <section className="alas-content">
            <Outlet />
          </section>
          </div>
        </main>
      </InternalErrorMonitor>
    </ConfigProvider>
  );
}
