import { test, expect } from "@playwright/test";

test.describe("Council Debate Flow", () => {
  test("submits query and shows debate transcript", async ({ page }) => {
    await page.goto("/");

    // Type a query
    await page.locator(".query-input").fill("Who authorized the Entity X payment?");
    await page.locator(".submit-btn").click();

    // Wait for debate to complete
    await expect(page.locator(".results")).toBeVisible({ timeout: 5000 });

    // Verify all 3 agents appear
    await expect(page.locator(".agent-turn")).toHaveCount(3);

    // Verify confidence badge
    await expect(page.locator(".confidence-badge")).toBeVisible();

    // Verify final answer
    await expect(page.locator(".final-answer")).toBeVisible();
  });

  test("shows contradictions for planted dossier query", async ({ page }) => {
    await page.goto("/");

    await page.locator(".query-input").fill("Was the Entity X payment legitimate?");
    await page.locator(".submit-btn").click();

    await expect(page.locator(".results")).toBeVisible({ timeout: 5000 });

    // Should find contradictions
    await expect(page.locator(".contradiction-item").first()).toBeVisible();
  });

  test("expands agent turn to show citations", async ({ page }) => {
    await page.goto("/");

    await page.locator(".query-input").fill("Who authorized the Entity X payment?");
    await page.locator(".submit-btn").click();

    await expect(page.locator(".agent-turn").first()).toBeVisible({ timeout: 5000 });

    // Click first agent turn to expand
    await page.locator(".agent-turn").first().click();

    // Citations should appear
    await expect(page.locator(".citations-panel").first()).toBeVisible();
  });

  test("disables submit with empty query", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator(".submit-btn")).toBeDisabled();
  });
});
