import { test, expect } from "@playwright/test";

test.describe("Responsive Layout", () => {
  const viewports = [
    { name: "mobile", width: 375, height: 812 },
    { name: "tablet", width: 768, height: 1024 },
    { name: "desktop", width: 1440, height: 900 },
  ];

  for (const vp of viewports) {
    test(`renders correctly on ${vp.name} (${vp.width}px)`, async ({ page }) => {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await page.goto("/");

      // No horizontal overflow
      const body = page.locator("body");
      const bodyBox = await body.boundingBox();
      expect(bodyBox).toBeTruthy();
      expect(bodyBox!.width).toBeLessThanOrEqual(vp.width + 1);

      // Header fits viewport
      const header = page.locator(".header");
      await expect(header).toBeVisible();

      // Query input is usable
      const input = page.locator(".query-input");
      await expect(input).toBeVisible();

      // Submit button accessible
      const btn = page.locator(".submit-btn");
      const btnBox = await btn.boundingBox();
      expect(btnBox).toBeTruthy();
      expect(btnBox!.height).toBeGreaterThanOrEqual(36);
    });
  }
});
