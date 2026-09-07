# Optional: hosting Monitor SDK packages

HTTP ingest is the default integration ([README](./README.md), [HTTP API](./HTTP.md)). Use these packages only if you want automatic `fetch` / navigation hooks. `@koralink/monitor-web` and `@koralink/monitor-react-native` both depend on `@koralink/monitor-core`. Host tarballs **from this API**, **GitHub Packages**, or **npmjs**.

## Option A — Tarballs from this API (simplest)

On the machine that runs the backend (or in CI):

```bash
npm run pack:sdk
```

That builds `packages/*/dist` and writes `.tgz` files to `packages/releases/`. The API serves them at:

| URL | Purpose |
|-----|---------|
| `GET /sdk` | JSON list of tarballs |
| `GET /sdk/<file.tgz>` | Download |

The **Monitor console → SDK packages** page copies install commands. From an app repo, install **core and** web (or React Native) **in one command** so npm does not try to fetch `@koralink/monitor-core` from npmjs:

```bash
# npm 12+ refuses tarball URLs unless you opt in (EALLOWREMOTE)
npm install --allow-remote=all \
  https://YOUR_API_HOST/sdk/koralink-monitor-core-0.1.0.tgz \
  https://YOUR_API_HOST/sdk/koralink-monitor-web-0.1.0.tgz

# or React Native:
npm install --allow-remote=all \
  https://YOUR_API_HOST/sdk/koralink-monitor-core-0.1.0.tgz \
  https://YOUR_API_HOST/sdk/koralink-monitor-react-native-0.1.0.tgz
```

Same machine, no remote fetch (no `--allow-remote` needed): download the files or point at `packages/releases/` after `npm run pack:sdk`:

```bash
npm install ./koralink-monitor-core-0.1.0.tgz ./koralink-monitor-web-0.1.0.tgz
```

Keep the same version on all three packages. The frontend (`http://localhost:5173`) proxies `/sdk` to the API; you can also use `http://localhost:3000/sdk/…` directly. Platform admins can browse packages at `/platform/packages`.

Nginx: proxy `/sdk` to the Node process the same way as `/ingest`.

## Option B — GitHub Packages

Packages already set `"publishConfig": { "registry": "https://npm.pkg.github.com" }`.

1. Push a tag `sdk-v0.1.0` (workflow `.github/workflows/publish-sdk.yml`).
2. In the consuming app, create `.npmrc`:

```
@koralink:registry=https://npm.pkg.github.com
//npm.pkg.github.com/:_authToken=YOUR_GITHUB_PAT
```

PAT needs `read:packages` (and SSO authorize if the org requires it).

```bash
npm install @koralink/monitor-web@0.1.0
```

## Option C — npmjs (public)

Remove `publishConfig.registry`, set `"private": false` if you want a public package, then:

```bash
npm run pack:sdk
npm publish -w @koralink/monitor-core
npm publish -w @koralink/monitor-web
npm publish -w @koralink/monitor-react-native
```

Requires an npm org named `koralink` (or rename the scope).

## Local path (monorepo / vendors)

```bash
npm install ../issue-monitoring/packages/monitor-web
```

Only works if that clone is on the same machine and you have run `npm run build` in `monitor-core` first.
