// Linter de JavaScript y React. Ver la sección de Construcción del Capítulo 3.
import js from '@eslint/js'
import reactHooks from 'eslint-plugin-react-hooks'
import globals from 'globals'

export default [
  { ignores: ['dist/', 'node_modules/', 'test-results/', 'playwright-report/'] },
  js.configs.recommended,
  {
    files: ['**/*.{js,jsx}'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: { ...globals.browser },
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
    plugins: { 'react-hooks': reactHooks },
    rules: {
      ...reactHooks.configs.recommended.rules,
      // JSX usa los componentes importados aunque ESLint no lo vea sin el plugin de React.
      'no-unused-vars': ['error', { varsIgnorePattern: '^[A-Z_]' }],
    },
  },
  // Configuración y pruebas de extremo a extremo corren en Node.
  { files: ['vite.config.js', 'playwright.config.js', 'e2e/**/*.js'], languageOptions: { globals: { ...globals.node } } },
]
