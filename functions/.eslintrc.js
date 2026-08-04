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
  overrides: [
    {
      // Tests favour compact assertions over the Google style guide's
      // formatting rules; correctness of the code under test is what matters.
      files: ['*.test.js'],
      rules: {
        'indent': 'off',
        'operator-linebreak': 'off',
        'brace-style': 'off',
        'curly': 'off',
        'valid-jsdoc': 'off',
      },
    },
  ],
};
