# ALAS Control Web

Umi 4 + React 18 + Ant Design 5 + ProComponents frontend for `/api/v1`.

## Development

```bash
npm install
PORT=8081 npm run dev
```

API requests are proxied to `http://127.0.0.1:22267`.

## Production

```bash
npm run build
npx tsc --noEmit
```

Output is written to `dist/`. Serve it from the same origin as the Control API,
or configure the development proxy during local work.
