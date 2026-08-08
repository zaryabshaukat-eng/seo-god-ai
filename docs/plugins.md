# Plugins

SEO GOD AI ships an extension system (`@seogod/plugin-sdk`) that lets the
platform accept sandboxed third-party code contributed by **plugins**. A
plugin is a `{ manifest, code }` bundle: the manifest declares identity,
permissions and contributions; the code provides their implementations. The
SDK compiles the code in an isolated V8 `vm` context, validates every manifest
and contribution, and enforces an explicit permission model before any
contribution can run.

> The SDK is the **only** package allowed to run third-party code. It never
> touches the network, the filesystem, or the process: it receives values and
> returns plain, structured results.

## Concepts

| Term            | Meaning                                                          |
| --------------- | ---------------------------------------------------------------- |
| `PluginManifest` | Declared identity (`id`, `name`, `version`), `permissions` and `contributions` |
| `PluginBundle`   | A `{ manifest, code }` pair handed to the registry                |
| `PluginRegistry` | Owns plugin lifecycle: install/update/enable/disable/uninstall, permission approval, sandboxed dispatch |
| `PluginErrorCode` | Stable error taxonomy (`invalidManifest`, `invalidVersion`, `notFound`, `conflict`, `stateConflict`, `permissionNotGranted`, `permissionNotDeclared`, `sandboxTimeout`, `sandboxEval`, `engineUnsatisfied`, ...) |
| `PluginState`   | `installed` → `enabled` → `disabled` → (uninstall); enabling runs `enable` hooks, dispatching requires `enabled` |
| `ALL_PLUGIN_PERMISSIONS` | Permissions the host is willing to grant, mapped one-to-one onto contribution kinds |

## Contributions

A manifest declares contributions; the code implements the matching keys.
Declaring a contribution without implementing it (or implementing one that was
never declared) is rejected at install time.

| Kind              | Manifest key           | Runtime signature                                     |
| ----------------- | ---------------------- | ----------------------------------------------------- |
| Tool              | `contributions.tools`  | `(args: Record<string, unknown>) => Promise<unknown>` — AI tools callable by the Copilot |
| Analyzer          | `contributions.analyzers` | `(context: AnalyzerContext) => Promise<AnalyzerOutput>` — custom SEO analyzers |
| Integration       | `contributions.integrations` | exposes a typed API to platform code              |
| Report generator  | `contributions.reportGenerators` | produces custom report sections                  |
| Event subscriber  | `contributions.eventSubscribers` | receives platform events                         |
| Execution action  | `contributions.executionActions` | `(input: { action, payload }) => Promise<{ ok: boolean, output }>` — gated by `execution.actions.execute` |
| UI extension     | `contributions.uiExtensions` | registers dashboard UI surface                      |
| Hooks             | `hooks` (`install`, `uninstall`, `enable`, `disable`) | optional lifecycle callbacks, fire-and-forget, failures are logged not fatal |

Every contribution kind maps onto exactly one required permission from
`ALL_PLUGIN_PERMISSIONS` (for example a tool requires
`plugin.tools.execute`). A plugin that requests a permission the host will
never grant is rejected; one that lacks a permission its contribution needs
cannot run that contribution.

## Sandbox

Code runs in a fresh V8 `vm` context behind the SDK's compiled wrapper:

- The **global scope is closed**: the contribution receives only `args`, a
  bound `log` (prefixed with the plugin id) and a `context` object. There is
  no `require`, no `process`, no `globalThis` access to host internals.
- Outputs are **deep-cloned**; functions, `undefined` and host objects are
  stripped. Inputs are cloned before they cross the boundary, so a plugin
  cannot retain or mutate host references.
- Execution is **time-boxed** with an external timeout. A contribution that
  runs long (or spins) is terminated and surfaces `sandboxTimeout`.
  Cross-realm detection is structural (`name === 'Error'` + message match)
  because `vm` timeouts are not `instanceof Error`.
- Code is parsed and executed only inside `vm.runInContext` with `timeout`
  set; a `sandboxEval` error means the code could not be compiled or started.

## Registry lifecycle

| Method          | Behavior                                                    |
| --------------- | ----------------------------------------------------------- |
| `install(bundle)` | Validates manifest + code, grants requested permissions, sets state to `installed`, fires `install` hook |
| `update(id, bundle)` | Replaces manifest + code in place, preserving state; the new version must remain compatible with the running SDK |
| `enable(id)`    | `installed`/`disabled` → `enabled`, fires `enable` hook       |
| `disable(id)`   | `enabled` → `disabled`, fires `disable` hook                  |
| `uninstall(id)` | Removes the plugin and disposes its sandbox (idempotent), fires `uninstall` hook |
| `list()` / `require(id)` | Enumerate or fetch one record; `require` throws `notFound` |
| `executeTool(id, args)` / `runAnalyzer(id, context)` / `executeAction(id, input)` | Dispatch to an **enabled** contribution after permission assertion |
| `dispose()`     | Tears down every sandbox; later calls are no-ops            |

Version compatibility uses semver (`@seogod/versions` style) for the manifest's
`version` and the SDK's `engines.pluginSdk` constraint; prerelease identifiers
and malformed versions are rejected.

## API surface

The platform exposes the registry over HTTP under `/api/v1/admin/plugins`
(management reads require `plugins.read`, mutations `plugins.write`):

```
GET    /api/v1/admin/plugins                      list plugins
POST   /api/v1/admin/plugins                      install { manifest, code }  → 201
GET    /api/v1/admin/plugins/:id                  fetch one plugin
PUT    /api/v1/admin/plugins/:id                  update bundle in place
DELETE /api/v1/admin/plugins/:id                  uninstall
POST   /api/v1/admin/plugins/:id/enable|disable   lifecycle transitions
POST   /api/v1/admin/plugins/dispatch/tools/:toolId       execute a tool
POST   /api/v1/admin/plugins/dispatch/analyzers/:analyzerId  run an analyzer
POST   /api/v1/admin/plugins/dispatch/actions/:actionId   run an execution action
```

Every registry failure is normalized into a canonical HTTP response:

| PluginErrorCode                          | HTTP            | `error.code`              |
| ---------------------------------------- | --------------- | ------------------------- |
| `notFound`                               | 404             | `plugin_not_found`        |
| `conflict`, `stateConflict`              | 409             | `plugin_conflict`         |
| `permissionNotGranted`, `permissionNotDeclared` | 403      | `plugin_permission_denied` |
| `sandboxTimeout`, `sandboxEval`          | 400             | `plugin_execution_error`  |
| everything else (validation, engine)     | 400             | `plugin_error`            |

## Writing a plugin

```ts
// manifest.json
{
  "schemaVersion": 1,
  "id": "acme.title-length",
  "name": "Acme Title Length",
  "version": "1.0.0",
  "engines": { "pluginSdk": "^0.3.0" },
  "permissions": ["plugin.analyzers.run"],
  "contributions": {
    "analyzers": [{ "id": "titleLength", "name": "Title Length" }]
  }
}
```

```ts
// code
(function () {
  return {
    contributions: {
      analyzers: {
        titleLength: async function (context) {
          const title = context.page?.title ?? '';
          return { score: title.length > 30 && title.length < 65 ? 90 : 40, issues: [], recommendations: [] };
        },
      },
    },
  };
})();
```

Install through the API (`POST /api/v1/admin/plugins` with `{ manifest, code }`),
then `POST /api/v1/admin/plugins/:id/enable` and dispatch via
`POST /api/v1/admin/plugins/dispatch/analyzers/titleLength`.

## Security posture

- Code is executed in a per-plugin `vm` sandbox with a closed global and a
  hard timeout; no host references leak in or out.
- Contributions cannot run unless the plugin requested and was granted the
  exact permission their kind requires, and cannot run at all while disabled.
- The SDK performs no I/O; any cross-boundary value is structured and cloned.
- Plugins never hold live handles to the platform; they are inert data +
  functions invoked only by the host.

## Testing

```bash
npm run test --workspace @seogod/plugin-sdk
npm run test:coverage --workspace @seogod/plugin-sdk   # 95% per metric
```

The suite covers manifest validation, version semantics, permission approval
and revocation, every registry transition, sandbox isolation and timeout
behavior, primitives passthrough, error taxonomy, and the API's plugin routes
including error mapping and RBAC denial.
