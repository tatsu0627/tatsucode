import { expect, test } from "@playwright/test";

test("diagnose uses only verified probes in the student display", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("link", { name: /demo|架空/i }).first().click();
  await page.getByRole("button", { name: /デモを試す/ }).click();
  await page.goto("/diagnose");
  await page.getByLabel("相談された概念").selectOption({ label: "Quadratic equations (depth 6)" });
  await page.getByRole("button", { name: "診断を開始" }).click();
  await expect(page).toHaveURL(/\/diagnose\?consultation=/);
  const studentDisplay = page.getByRole("region", { name: "学生表示" });
  const generate = page.getByRole("button", { name: "確認問題を生成する" });
  const review = page.getByRole("link", { name: "レビュー画面を開く" });
  await expect(studentDisplay.or(generate).or(review)).toBeVisible();
  if (await studentDisplay.isVisible()) await expect(studentDisplay.getByText(/solution steps/i)).toHaveCount(0);
});
