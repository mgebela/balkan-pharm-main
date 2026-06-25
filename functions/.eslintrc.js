module.exports = {
  env: {
    es6: true,
    node: true,
  },
  parserOptions: {
    ecmaVersion: 2022,
  },
  extends: ['eslint:recommended', 'google'],
  rules: {
    'require-jsdoc': 'off',
    'max-len': ['error', {code: 120}],
    'quote-props': 'off',
    'linebreak-style': 'off',
  },
};
