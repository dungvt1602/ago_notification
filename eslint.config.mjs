// @ts-check
import eslint from '@eslint/js';
import eslintConfigPrettier from 'eslint-config-prettier';
import tseslint from 'typescript-eslint';

/*
 * ESLint flat config — TypeScript strict + prettier.
 * Dự án chuyển từ Next.js: logic nghiệp vụ giữ nguyên ở src/core (copy), controller NestJS mỏng ở src/modules.
 */
export default tseslint.config(
  { ignores: ['dist/**', 'coverage/**', 'node_modules/**', 'eslint.config.mjs'] },
  eslint.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  eslintConfigPrettier,
  {
    languageOptions: {
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-unsafe-argument': 'warn',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      '@typescript-eslint/explicit-module-boundary-types': 'off',
      '@typescript-eslint/no-extraneous-class': 'off',
      'no-console': 'error',
    },
  },
  {
    // Code port nguyên văn từ app Next (core/shared) + controller bọc 1:1: không viết lại chỉ để vừa luật phong cách,
    // vì đổi code = rủi ro đổi hành vi. Siết dần khi có test bao phủ.
    files: ['src/core/**/*.ts', 'src/shared/**/*.ts', 'src/modules/**/*.ts'],
    rules: {
      'no-console': 'off',
      'no-useless-assignment': 'off',
      'preserve-caught-error': 'off',
      '@typescript-eslint/no-base-to-string': 'off',
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-argument': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
      '@typescript-eslint/no-unsafe-return': 'off',
      '@typescript-eslint/no-unnecessary-type-assertion': 'off',
      '@typescript-eslint/restrict-template-expressions': 'off',
      '@typescript-eslint/restrict-plus-operands': 'off',
    },
  },
  {
    files: ['scripts/**/*.ts', 'test/**/*.ts', '**/*.spec.ts'],
    rules: { 'no-console': 'off' },
  },
);
