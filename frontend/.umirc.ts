import { defineConfig } from '@umijs/max';

export default defineConfig({
  antd: {},
  request: {},
  hash: true,
  history: { type: 'hash' },
  favicons: [],
  layout: false,
  npmClient: 'npm',
  proxy: {
    '/api': {
      target: 'http://127.0.0.1:22267',
      changeOrigin: true,
      ws: true,
    },
  },
  routes: [
    { path: '/login', component: '@/pages/Login' },
    {
      path: '/',
      component: '@/layouts/BasicLayout',
      routes: [
        { path: '/', redirect: '/instances' },
        { path: '/home', component: '@/pages/Home' },
        { path: '/instances', component: '@/pages/Instances' },
        { path: '/instances/:name', component: '@/pages/InstanceDetail' },
        { path: '/manage', component: '@/pages/Manage' },
        { path: '/update', component: '@/pages/Update' },
        { path: '/remote', component: '@/pages/Remote' },
        { path: '/utils', component: '@/pages/Utils' },
      ],
    },
  ],
});
