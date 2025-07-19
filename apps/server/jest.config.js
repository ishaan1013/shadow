/* eslint-env node */
export default {
  preset: "ts-jest",
  testEnvironment: "node",
  testEnvironmentOptions: {
    nodeOptions: ["--experimental-vm-modules"]
  },
  moduleNameMapper: {
    "^@/(.*)$": "<rootDir>/src/$1"
  },
  testMatch: ["**/*.test.ts", "**/*.test.tsx"]
};