const { defineConfig } = require('@playwright/test');
module.exports = defineConfig({
  testDir: './tests',
  testMatch: 'mobile-ui.spec.cjs',
  timeout: 45_000,
  expect: {timeout: 12_000},
  retries: 0,
  workers: 1,
  use: {baseURL: process.env.MOBILE_BASE_URL || 'http://127.0.0.1:8787',trace:'retain-on-failure'},
  reporter: [['list'],['html',{open:'never',outputFolder:'playwright-report'}]]
});
