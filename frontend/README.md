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

Output is written to `dist/` and is served by the backend at
`http://127.0.0.1:22267/app/` (mounted in `module/webui/fastapi.py`).

`publicPath: '/app/'` keeps asset URLs under the mount point; routing stays
hash-based, so no server-side rewrite is needed. If you change the mount path,
update `publicPath` in `.umirc.ts` as well. Note that umi's hash history does
not combine with a `base`/basename — setting one blanks the page.
