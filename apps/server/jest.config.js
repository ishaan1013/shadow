/* eslint-env node */
export default {
  preset: "ts-jest/presets/default-esm",
  extensionsToTreatAsEsm: [".ts"],
  testEnvironment: "node",
  testEnvironmentOptions: {
    nodeOptions: ["--experimental-vm-modules"]
  },
  moduleNameMapper: {
    "^@/(.*)$": "<rootDir>/src/$1"
  },
  testMatch: ["**/*.test.ts", "**/*.test.tsx"],
  globals: {
    "ts-jest": {
      useESM: true
    }
  }
};