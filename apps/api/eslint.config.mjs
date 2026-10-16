import { defineConfig, globalIgnores } from 'eslint/config';

import rootEslintConfig from '../../eslint.root.mjs';

const restrictedPackagePatterns = [
  {
    group: ['@apps/web', '@apps/web/*', '**/apps/web/**'],
    message:
      'The api serves the web app over HTTP and knows nothing of its components - share the contract through @libs/dto instead.',
  },
];

const apiPattern = {
  group: ['@/api', '@/api/**', '**/api/**'],
  message:
    'api/ is the management API, one caller of core/. Reach the domain through core/ instead, so no other caller is handed the shape the web app reads.',
};

const firefoxPattern = {
  group: ['@/firefox', '@/firefox/**', '**/firefox/**'],
  message:
    "firefox/ speaks Mozilla's wire formats to Firefox, one caller of core/. Reach the domain through core/ instead, so no other caller is handed a Mozilla shape.",
};

const entryPointPattern = {
  group: ['@/entry-point', '@/entry-point/**', '**/entry-point/**'],
  message:
    'entry-point/ holds the policies that differ between api/ and firefox/, and sits above both. Nothing below it may depend on it.',
};

const corePattern = {
  group: ['@/core', '@/core/**', '**/core/**'],
  message: 'Plumbing reads the same in any application, so it knows nothing of what this one is about.',
};

// No global pipe validates a request, so a parameter without one reaches the route unchecked.
const unparsedRequestSelector = pipe =>
  `Decorator > CallExpression[callee.name=/^(Body|Query|Param)$/]:not(:has(NewExpression[callee.name='${pipe}']))`;

const unparsedApiRequest = {
  selector: unparsedRequestSelector('ZodPipe'),
  message: 'Parse every body, query and param through a ZodPipe with a @libs/dto schema.',
};

const unparsedFirefoxRequest = {
  selector: unparsedRequestSelector('FxaZodPipe'),
  message:
    "Parse every body, query and param through an FxaZodPipe with a schema beside the controller, so a refusal carries Mozilla's errno.",
};

/** Each layer replaces the rule wholesale, so each repeats the package patterns every file has. */
const restrictImports = (...layerPatterns) => ({
  '@typescript-eslint/no-restricted-imports': ['error', { patterns: [...restrictedPackagePatterns, ...layerPatterns] }],
});

export default defineConfig([
  globalIgnores(['vitest.config.ts', 'vitest.integration.config.ts']),
  {
    extends: [rootEslintConfig],
    rules: {
      '@typescript-eslint/no-extraneous-class': 'off',
      'no-restricted-imports': 'off',
      ...restrictImports(),
    },
  },
  {
    files: ['src/core/**/*.ts'],
    rules: restrictImports(apiPattern, firefoxPattern, entryPointPattern),
  },
  {
    files: ['src/api/**/*.ts'],

    rules: {
      ...restrictImports(firefoxPattern, entryPointPattern),
      'no-restricted-syntax': ['error', unparsedApiRequest],
    },
  },
  {
    files: ['src/firefox/**/*.ts'],

    rules: {
      ...restrictImports(apiPattern, entryPointPattern),
      'no-restricted-syntax': ['error', unparsedFirefoxRequest],
    },
  },
  {
    // The test data migration seeds an account through core/user's onepw, as sign-up would.
    files: ['src/{common,config,database,email,logger}/**/*.ts'],
    ignores: ['src/database/migrations/test/**'],
    rules: restrictImports(corePattern, apiPattern, firefoxPattern, entryPointPattern),
  },
  {
    // Mozilla's wire formats name fields `client_id`, `keys_jwe` and `fxa-generation`, and the DTOs and responses
    // that speak them must use those names. A schema is named for the shape it parses, as a type would be.
    files: ['src/firefox/**/*.ts', 'integration/**/*.ts'],

    rules: {
      '@typescript-eslint/naming-convention': [
        'error',
        { selector: 'default', format: ['camelCase'] },
        { selector: 'variable', format: ['camelCase', 'UPPER_CASE'] },
        { selector: 'variable', filter: { regex: 'Dto$', match: true }, format: ['PascalCase'] },
        { selector: 'parameter', format: ['camelCase'], leadingUnderscore: 'allow' },
        { selector: 'property', format: ['camelCase', 'PascalCase', 'UPPER_CASE', 'snake_case'] },
        { selector: 'property', modifiers: ['requiresQuotes'], format: null },
        { selector: 'method', format: ['camelCase', 'UPPER_CASE'] },
        { selector: 'import', format: ['camelCase', 'PascalCase'] },
        { selector: 'typeLike', format: ['PascalCase'] },
        { selector: 'enumMember', format: ['UPPER_CASE'] },
        { selector: 'interface', format: ['PascalCase'], custom: { regex: '^I[A-Z]', match: true } },
      ],
    },
  },
  {
    // `queryRunner.query` returns `any`, so naming a row's shape is the only way to read one.
    files: ['src/database/migrations/**/*.ts'],

    rules: {
      '@typescript-eslint/consistent-type-assertions': 'off',
    },
  },
  {
    // `integration/` sits outside the build tsconfig's include, so it needs a project
    // that covers it for the type-aware rules to resolve. Must come after the block
    // above, which sets the project for everything else.
    files: ['integration/**/*.ts'],

    languageOptions: {
      parserOptions: {
        project: './tsconfig.integration.json',
      },
    },

    rules: {
      // supertest types a response body as `any`, so asserting against one trips the
      // unsafe-any family on almost every line. Production code stays strict.
      '@typescript-eslint/no-unsafe-argument': 'off',
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-return': 'off',
    },
  },
]);
