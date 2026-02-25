module.exports = {
  root: true,
  env: {
    node: true,
    es2022: true,
    browser: true
  },
  parser: '@typescript-eslint/parser',
  parserOptions: {
    ecmaVersion: 'latest',
    sourceType: 'module'
  },
  plugins: ['@typescript-eslint'],
  extends: ['eslint:recommended'],
  ignorePatterns: ['dist/', 'node_modules/'],
  rules: {
    'no-unused-vars': 'off',
    'no-useless-escape': 'off',
    'no-constant-condition': 'off'
  }
};
