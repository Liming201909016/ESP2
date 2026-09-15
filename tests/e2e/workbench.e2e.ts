import { expect, test } from "@playwright/test";

test("persists locale and opens the security review workspace", async ({ page }) => {
  await page.goto("/");

  await expect(page.getByRole("heading", { level: 1, name: "Capability Workbench" })).toBeVisible();
  await page.getByRole("combobox", { name: "Language" }).selectOption("zh-CN");
  await expect(page.getByRole("heading", { level: 1, name: "技能编排工作台" })).toBeVisible();

  await page.reload();
  await expect(page.getByRole("combobox", { name: "语言" })).toHaveValue("zh-CN");
  await page.getByRole("button", { name: "安全审查", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1, name: "软件引入安全审查" })).toBeVisible();
});
