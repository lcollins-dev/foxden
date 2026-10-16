import { defineConfig, globalIgnores } from 'eslint/config';

import rootEslintConfig from '../eslint.root.mjs';

export default defineConfig([
  globalIgnores(['.bin', '.artifacts', '.android', '.firefox']),
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

      // A CLI harness: the console is its output.
      'no-console': 'off',

      // The root's naming rules, plus PascalCase variables to mirror Firefox's own globals and module exports.
      '@typescript-eslint/naming-convention': [
        'error',
        { selector: 'default', format: ['camelCase'] },
        { selector: 'variable', format: ['camelCase', 'UPPER_CASE', 'PascalCase'] },
        { selector: 'parameter', format: ['camelCase'], leadingUnderscore: 'allow' },
        { selector: 'property', format: ['camelCase', 'PascalCase', 'UPPER_CASE'] },
        {
          selector: ['objectLiteralProperty', 'typeProperty'],
          format: ['camelCase', 'PascalCase', 'UPPER_CASE', 'snake_case'],
        },
        { selector: ['objectLiteralProperty', 'typeProperty'], modifiers: ['requiresQuotes'], format: null },
        { selector: 'method', format: ['camelCase', 'UPPER_CASE'] },
        { selector: 'import', format: ['camelCase', 'PascalCase'] },
        { selector: 'typeLike', format: ['PascalCase'] },
        { selector: 'enumMember', format: ['UPPER_CASE'] },
        { selector: 'interface', format: ['PascalCase'], custom: { regex: '^I[A-Z]', match: true } },
      ],
    },
  },
]);
