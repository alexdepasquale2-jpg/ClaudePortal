import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import boundaries from 'eslint-plugin-boundaries';

/**
 * The layer graph is enforced here, not by convention.
 *
 * The rule that matters most: `ui` may NOT import `gameplay`.
 * That is the mechanical enforcement of ADR-0002 (session-only forts) — campaign menu
 * code such as FortsMenuController physically cannot reach FortRuntime, only the
 * persisted campaign history. See docs/ARCHITECTURE.md.
 */
export default tseslint.config(
  {
    ignores: [
      'dist/**',
      'node_modules/**',
      'playwright-report/**',
      'test-results/**',
      'coverage/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    plugins: { boundaries },
    settings: {
      // Without a resolver the plugin cannot follow '@gameplay/...' aliases, and every
      // cross-layer import becomes invisible to it — the rule silently passes everything.
      'import/resolver': {
        typescript: { alwaysTryTypes: true, project: './tsconfig.json' },
      },
      'boundaries/include': ['src/**/*.ts', 'tools/**/*.ts', 'tests/**/*.ts'],
      'boundaries/elements': [
        { type: 'core', pattern: 'src/core/**' },
        { type: 'render', pattern: 'src/render/**' },
        { type: 'campaign', pattern: 'src/campaign/**' },
        { type: 'gameplay', pattern: 'src/gameplay/**' },
        { type: 'ui', pattern: 'src/ui/**' },
        { type: 'scenes', pattern: 'src/scenes/**' },
        { type: 'app', pattern: 'src/*.ts', mode: 'full' },
        { type: 'tools', pattern: 'tools/**' },
        { type: 'tests', pattern: 'tests/**' },
      ],
    },
    rules: {
      'boundaries/element-types': [
        'error',
        {
          default: 'disallow',
          rules: [
            // core is the foundation: it imports no other layer.
            { from: ['core'], allow: ['core'] },
            // render is presentation plumbing over core contracts — no game logic.
            { from: ['render'], allow: ['core', 'render'] },
            // the campaign graph is the permanent record; it knows nothing of a live run.
            { from: ['campaign'], allow: ['core', 'campaign'] },
            // a run reads and writes the campaign graph — that is the whole point.
            { from: ['gameplay'], allow: ['core', 'campaign', 'gameplay', 'render'] },
            // NOTE: 'gameplay' is deliberately absent here. Do not add it.
            { from: ['ui'], allow: ['core', 'campaign', 'ui', 'render'] },
            // scenes are the composition root: one operation = one scene.
            { from: ['scenes'], allow: ['core', 'campaign', 'gameplay', 'ui', 'render', 'scenes'] },
            { from: ['app'], allow: ['core', 'scenes', 'render'] },
            {
              from: ['tools'],
              allow: ['core', 'campaign', 'gameplay', 'ui', 'render', 'scenes', 'tools'],
            },
            {
              from: ['tests'],
              allow: ['core', 'campaign', 'gameplay', 'ui', 'render', 'scenes', 'tests'],
            },
          ],
        },
      ],
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      // Scaffolding: signatures are declared before behaviour exists.
      '@typescript-eslint/no-empty-function': 'off',
    },
  },
);
