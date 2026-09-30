import { defineConfig, devices } from '@playwright/test';

const baseURL = process.env.KANBAN_URL ?? 'http://localhost:8080';
const outDir = process.env.EVAL_OUT ?? 'results/local';

// Every test is tagged with exactly one scoring area: @api, @moves or @ui (see score.mjs).
// Tests tagged @xss are critical: any failure caps the score at 40 (PRD §11).
export default defineConfig({
  testDir: './tests',
  outputDir: `${outDir}/test-artifacts`,
  // The app under test runs a single SQLite writer; keep the load deterministic.
  fullyParallel: false,
  workers: 1,
  timeout: 45_000,
  expect: { timeout: 7_000 },
  reporter: [
    ['list'],
    ['json', { outputFile: `${outDir}/playwright.json` }],
    ['html', { outputFolder: `${outDir}/html`, open: 'never' }],
  ],
  use: {
    baseURL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'api', testDir: './tests/api', retries: 0, use: { extraHTTPHeaders: { accept: 'application/json' } } },
    {
      name: 'ui',
      testDir: './tests/ui',
      // One retry absorbs timing flakiness in drag-and-drop; a flaky pass still counts as a pass.
      retries: 1,
      use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } },
    },
  ],
});
