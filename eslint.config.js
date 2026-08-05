const js = require('@eslint/js')
const vue = require('eslint-plugin-vue')
const tseslint = require('typescript-eslint')

module.exports = tseslint.config(
  {
    ignores: [
      '**/dist/**',
      'apps/web/public/generated/**',
      '**/node_modules/**',
      '**/target/**',
      'build/*.js',
      'config/*.js',
      'src/libs/*.js',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  ...vue.configs['flat/recommended'],
  {
    files: ['apps/**/*.{ts,vue}', 'packages/**/*.{ts,vue}'],
    languageOptions: {
      globals: {
        window: 'readonly',
        document: 'readonly',
        DOMParser: 'readonly',
        HTMLElement: 'readonly',
        SVGElement: 'readonly',
        SVGSVGElement: 'readonly',
        URL: 'readonly',
        URLSearchParams: 'readonly',
      },
      parserOptions: {
        parser: tseslint.parser,
      },
    },
  },
  {
    files: ['apps/**/*.vue'],
    rules: {
      'vue/max-attributes-per-line': 'off',
      'vue/multi-word-component-names': 'off',
      'vue/singleline-html-element-content-newline': 'off',
    },
  },
  {
    files: ['eslint.config.js'],
    languageOptions: {
      globals: {
        module: 'readonly',
        require: 'readonly',
      },
    },
    rules: {
      '@typescript-eslint/no-require-imports': 'off',
    },
  },
)
