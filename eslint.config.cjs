const { defineConfig, globalIgnores } = require('eslint/config');

const { fixupConfigRules } = require('@eslint/compat');

const reactRefresh = require('eslint-plugin-react-refresh');
const tsParser = require('@typescript-eslint/parser');
const js = require('@eslint/js');

const { FlatCompat } = require('@eslint/eslintrc');

const compat = new FlatCompat({
  baseDirectory: __dirname,
  recommendedConfig: js.configs.recommended,
  allConfig: js.configs.all,
});

module.exports = defineConfig([
  {
    extends: fixupConfigRules(
      compat.extends(
        'eslint:recommended',
        'plugin:react/recommended',
        'plugin:react-hooks/recommended',
        'plugin:import/recommended',
        'plugin:jsx-a11y/recommended',
        'plugin:@typescript-eslint/recommended',
        'eslint-config-prettier',
      ),
    ),

    plugins: {
      'react-refresh': reactRefresh,
    },

    languageOptions: {
      parser: tsParser,

      parserOptions: {
        project: ['./tsconfig.json'],
      },
    },

    settings: {
      react: {
        version: 'detect',
      },

      'import/resolver': {
        node: {
          paths: ['src-web'],
          extensions: ['.ts', '.tsx'],
        },
      },
    },

    rules: {
      'react-refresh/only-export-components': 'error',
      'jsx-a11y/no-autofocus': 'off',
      'react/react-in-jsx-scope': 'off',
      'import/no-unresolved': 'off',

      '@typescript-eslint/consistent-type-imports': [
        'error',
        {
          prefer: 'type-imports',
          disallowTypeAnnotations: true,
          fixStyle: 'separate-type-imports',
        },
      ],
    },
  },
  globalIgnores([
    'scripts/**/*',
    'packages/plugin-runtime/**/*',
    'packages/plugin-runtime-types/**/*',
    'src-tauri/**/*',
    'src-web/tailwind.config.cjs',
    'src-web/vite.config.ts',
  ]),
  globalIgnores([
    '**/node_modules/',
    '**/dist/',
    '**/build/',
    '**/.eslintrc.cjs',
    '**/.prettierrc.cjs',
    'src-web/postcss.config.cjs',
    'src-web/vite.config.ts',
  ]),
]);
