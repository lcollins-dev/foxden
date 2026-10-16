import { defineConfig } from 'eslint/config';

import rootEslintConfig from '../../eslint.root.mjs';

export default defineConfig([
  {
    extends: [rootEslintConfig],

    languageOptions: {
      parserOptions: {
        project: './tsconfig.test.json',
      },
    },

    rules: {
      'no-restricted-imports': 'off',
      '@typescript-eslint/no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@apps/*', '**/apps/**', 'node:*'],
              message:
                'The crypto lib runs in the browser as well as in Node, so it may depend on neither app nor on a Node built-in. Use globalThis.crypto.',
            },
          ],
        },
      ],
    },
  },
]);
