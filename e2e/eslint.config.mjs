import { defineConfig } from 'eslint/config';

import rootEslintConfig from '../eslint.root.mjs';

export default defineConfig([
  {
    extends: [rootEslintConfig],

    languageOptions: {
      sourceType: 'module',
    },

    rules: {
      // The whole workspace is test code, so it takes the relaxations the root config gives test files.
      'id-length': 'off',
      '@typescript-eslint/no-non-null-assertion': 'off',
      '@typescript-eslint/consistent-type-assertions': 'off',
      '@typescript-eslint/strict-boolean-expressions': 'off',
    },
  },
]);
