module.exports = {
  extends: [
    'eslint:recommended',
    'plugin:react/recommended',
    'plugin:react-hooks/recommended',
    'plugin:import/recommended',
    'plugin:jsx-a11y/recommended',
    'plugin:@typescript-eslint/recommended',
    'eslint-config-prettier',
  ],
  plugins: ['react-refresh'],
  parser: '@typescript-eslint/parser',
  parserOptions: {
    project: ['./tsconfig.json'],
  },
  ignorePatterns: [
    'scripts/**/*',
    'packages/plugin-runtime/**/*',
    'packages/plugin-runtime-types/**/*',
    'src-tauri/**/*',
    'src-web/tailwind.config.cjs',
    'src-web/vite.config.ts',
  ],
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
};
