import { expect, test } from "@playwright/test";

test("prepare, verify, and run a material", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("link", { name: /demo|\u67b6\u7a7a/i }).first().click();
  await page.getByRole("button", { name: /\u30c7\u30e2\u3092\u8a66\u3059/ }).click();
  await page.goto("/materials/new");
  await page.getByLabel(/\u5206\u91ce/).fill("Linear equations");
  await page.getByLabel(/\u5b66\u7fd2\u76ee\u6a19/).fill("Solve equations and verify each result");
  await page.getByRole("button", { name: /AI/ }).click();
  await expect(page.getByText(/\u672a\u78ba\u8a8d/)).toBeVisible();
  const verify = page.getByRole("button", { name: /\u78ba\u8a8d\u6e08\u307f\u306b\u3059\u308b/ });
  await expect(verify).toBeDisabled();
  for (const checkbox of await page.getByRole("checkbox").all()) await checkbox.check();
  await expect(verify).toBeEnabled();
  await verify.click();
  await page.goto("/library");
  await expect(page.getByText("Linear equations")).toBeVisible();
  await page.getByRole("link", { name: /\u30bb\u30c3\u30b7\u30e7\u30f3\u30e2\u30fc\u30c9/ }).first().click();
  await page.getByRole("button", { name: /\u30d2\u30f3\u30c8\u3092\u898b\u308b/ }).click();
  await expect(page.getByText(/1 \/ 3|1 \/ 1/)).toBeVisible();
});
