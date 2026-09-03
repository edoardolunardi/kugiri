import { expect, type Page, test } from "@playwright/test";

// The demo page is the test suite: every case splits as it scrolls into view, and its check
// compares the split with the lines the browser painted before it, text and geometry.

async function revealEverything(page: Page) {
  await expect(page.locator("[data-readout]")).not.toHaveText(/targets 0/);

  const height = await page.evaluate(() => document.documentElement.scrollHeight - window.innerHeight);

  for (let y = 0; y <= height + 600; y += 600) {
    await page.evaluate((top) => window.scrollTo({ top, behavior: "instant" }), Math.min(y, height));
    await page.waitForTimeout(120);
  }

  // The longest reveal is a second; the check reads the settled DOM.
  await page.waitForTimeout(2500);
}

/**
 * Cases whose split is right at the moment it is made but whose geometry a browser changes
 * afterwards: WebKit renders a `::first-line` without the `text-transform` it reports, then applies
 * it once an animation has touched the line. The lines themselves are still asserted.
 */
const GEOMETRY_KNOWN_TO_DRIFT: Record<string, string[]> = {
  webkit: ["first-line"],
};

async function expectEveryCaseAsPainted(page: Page, browserName: string) {
  await page.getByRole("button", { name: "Check lines" }).click();

  const cases = page.locator("section[data-case]");
  const count = await cases.count();

  expect(count).toBeGreaterThan(40);

  for (let index = 0; index < count; index += 1) {
    const section = cases.nth(index);
    const id = await section.getAttribute("data-case");
    const result = (await section.locator(".case-result").textContent()) ?? "";
    const status = await section.getAttribute("data-status");
    const knownDrift = GEOMETRY_KNOWN_TO_DRIFT[browserName]?.includes(id ?? "") && / lines as painted, but /.test(result);

    if (status === "mismatch" && knownDrift) {
      continue;
    }

    expect(status, `${id}: ${result}`).toBe("ok");
  }
}

test("every case splits exactly as the browser painted it", async ({ page, browserName }) => {
  await page.goto("/");
  await revealEverything(page);
  await expectEveryCaseAsPainted(page, browserName);
});

test("a replay reverts and splits again to the same result", async ({ page, browserName }) => {
  await page.goto("/");
  await revealEverything(page);
  await page.getByRole("button", { name: "Replay all" }).click();
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));
  await revealEverything(page);
  await expectEveryCaseAsPainted(page, browserName);
});

test("a split leaves no empty link behind", async ({ page }) => {
  await page.goto("/");
  await revealEverything(page);

  const emptyLinks = await page.evaluate(
    () => Array.from(document.querySelectorAll("[data-target] a")).filter((a) => !a.textContent?.trim()).length
  );

  expect(emptyLinks).toBe(0);
});
