import { test, expect } from '@playwright/test';

test('App loads successfully and displays the correct title', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveTitle(/Quorum/);
});
