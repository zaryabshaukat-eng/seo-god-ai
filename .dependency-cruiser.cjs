/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    {
      name: 'no-circular',
      severity: 'error',
      comment: 'Circular dependencies between modules are forbidden.',
      from: {},
      to: { circular: true },
    },
    {
      name: 'no-orphans',
      severity: 'warn',
      comment: 'Every module must be reachable from an entry point.',
      from: { orphan: true, pathNot: '\\.test\\.ts$|\\.spec\\.ts$' },
      to: {},
    },
  ],
  options: {
    doNotFollow: { path: 'node_modules' },
    exclude: { path: '(dist|coverage|generated|migrations|node_modules|__fixtures__)' },
    includeOnly: '^(apps|packages)/',
    tsPreCompilationDeps: true,
    tsConfig: { fileName: 'tsconfig.base.json' },
    enhancedResolveOptions: {
      exportsFields: ['exports'],
    },
    reporterOptions: {
      dot: { collapsePattern: '^(node_modules/[^/]+)' },
    },
  },
};
