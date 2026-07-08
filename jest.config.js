module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  reporters: ['default', 'jest-junit'],
  moduleNameMapper: {
    '^@actions/github$': '<rootDir>/__mocks__/@actions/github.js',
  },
};
