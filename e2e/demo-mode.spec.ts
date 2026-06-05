import { test, expect } from "@playwright/test";

test.describe("Demo Mode Smoke Tests", () => {
  test("loads without errors", async ({ page }) => {
    const errors: string[] = [];
    page.on("console", (msg) => {
      if (msg.type() === "error") errors.push(msg.text());
    });
    await page.goto("/");
    await expect(page.locator(".app")).toBeVisible();
    await expect(page.locator(".title")).toHaveText("Quorum");
    expect(errors.filter((e) => !e.includes("favicon") && !e.includes("502") && !e.includes("Bad Gateway"))).toHaveLength(0);
  });

  test("shows offline network pill", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator(".network-pill")).toContainText("OFFLINE");
  });

  test("has proper page title", async ({ page }) => {
    await page.goto("/");
    await expect(page).toHaveTitle(/Quorum|Vite/);
  });
});
