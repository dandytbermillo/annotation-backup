import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright E2E Configuration with Service Worker Support
 * For Unified Offline Foundation testing
 */

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: 'html',
  
  use: {
    baseURL: 'http://localhost:3000',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    
    // Enable Service Worker for offline testing
    serviceWorkers: 'allow',
    
    // Default context options
    contextOptions: {
      // Accept self-signed certificates for local testing
      ignoreHTTPSErrors: true,
      
      // Enable offline mode testing
      offline: false, // Will be overridden in specific tests
      
      // Permissions for notifications, background sync, etc.
      permissions: ['notifications', 'background-sync'],
    },
  },

  projects: [
    {
      name: 'chromium',
      use: { 
        ...devices['Desktop Chrome'],
        // Chrome has best Service Worker support
        launchOptions: {
          args: [
            '--enable-features=BackgroundSync',
            '--enable-background-sync',
          ],
        },
      },
    },
    {
      name: 'firefox',
      use: { ...devices['Desktop Firefox'] },
    },
    {
      name: 'webkit',
      use: { ...devices['Desktop Safari'] },
    },
    {
      name: 'mobile-chrome',
      use: { ...devices['Pixel 5'] },
    },
    {
      name: 'mobile-safari',
      use: { ...devices['iPhone 12'] },
    },
  ],

  // Dev server configuration
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:3000',
    reuseExistingServer: !process.env.CI,
    timeout: 120 * 1000,
  },
});