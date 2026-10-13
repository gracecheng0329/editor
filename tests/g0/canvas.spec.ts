import { expect, test } from "@playwright/test";

test("TV-01: client-only canvas mounts in the verification page", async ({ page }) => {
  await page.goto("/g0");
  await expect(page.getByRole("heading", { name: "G0 同步驗證" })).toBeVisible();
  await expect(page.getByRole("button", { name: "新增節點" })).toBeEnabled();
  await page.getByRole("button", { name: "新增節點" }).click();
  await expect(page.getByLabel("物件數")).toHaveText("1");
});
