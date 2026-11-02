import { test, expect } from "@playwright/test";
import type { Comparison } from "../src/api";

test.beforeEach(async ({ page }) => {
  await page.route("**/api/comparisons", async (route) => {
    const result = await route.fetch();
    const comparison: Comparison = await result.json();
    comparison.responses.forEach((response, index) => {
      response.text = [
        "A readable introduction.\nA second line.",
        "```python\n    print('preserve indentation')\n" +
          "x".repeat(2000) +
          "\n```",
        ...Array.from(
          { length: 50 + index * 20 },
          (_, line) =>
            `Paragraph ${line}: a detailed explanation of this answer.`,
        ),
      ].join("\n\n");
    });
    comparison.responses[0].model += "-" + "long-model-name-".repeat(5);
    await route.fulfill({ response: result, json: comparison });
  });
});

async function compare(page: import("@playwright/test").Page) {
  await page.goto("/");
  await page
    .getByLabel("What would you like to explore?")
    .fill("Give detailed answers with code");
  await page.getByRole("button", { name: "Compare responses" }).click();
  await expect(
    page.getByRole("region", { name: /^Response from/ }),
  ).toHaveCount(2);
}

test("desktop responses align, scroll independently with the keyboard, and expand separately", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 1000 });
  await compare(page);
  const regions = page.getByRole("region", { name: /^Response from/ });
  const first = regions.first();
  const second = regions.nth(1);
  // Keyboard scrolling animates even after scrollTop becomes positive. Wait for
  // the browser's scrollend event before comparing the two independent panels.
  async function pageDown(region: typeof first) {
    await region.focus();
    await region.evaluate((element) => {
      element.setAttribute("data-scroll-finished", "false");
      element.addEventListener(
        "scrollend",
        () => element.setAttribute("data-scroll-finished", "true"),
        { once: true },
      );
    });
    await region.press("PageDown");
    await expect(region).toHaveAttribute("data-scroll-finished", "true");
  }
  const cards = page.locator(".response-card");
  const cardSizes = await cards.evaluateAll((elements) =>
    elements.map((element) => element.getBoundingClientRect().height),
  );
  expect(Math.abs(cardSizes[0] - cardSizes[1])).toBeLessThanOrEqual(1);
  expect(await first.evaluate((element) => element.clientHeight)).toBe(450);
  expect(await second.evaluate((element) => element.clientHeight)).toBe(450);

  await pageDown(first);
  await expect
    .poll(() => first.evaluate((element) => element.scrollTop))
    .toBeGreaterThan(0);
  expect(await second.evaluate((element) => element.scrollTop)).toBe(0);
  const firstScroll = await first.evaluate((element) => element.scrollTop);
  await pageDown(second);
  await expect
    .poll(() => second.evaluate((element) => element.scrollTop))
    .toBeGreaterThan(0);
  expect(await first.evaluate((element) => element.scrollTop)).toBe(
    firstScroll,
  );

  await expect(first.locator("pre code")).toContainText(
    "    print('preserve indentation')",
  );
  expect(
    await first.evaluate(
      (element) => element.querySelectorAll("button").length,
    ),
  ).toBe(0);
  await expect(
    cards.first().getByRole("button", { name: "Vote for this response" }),
  ).toBeEnabled();
  const expand = page
    .getByRole("button", { name: /^Expand response from/ })
    .first();
  await expect(expand).toHaveAttribute(
    "aria-controls",
    (await first.getAttribute("id")) as string,
  );
  await expect(expand).toHaveAttribute("aria-expanded", "false");
  await expand.click();
  const collapse = page.getByRole("button", {
    name: /^Collapse response from/,
  });
  await expect(collapse).toHaveAttribute("aria-expanded", "true");
  expect(
    await first.evaluate((element) => element.clientHeight),
  ).toBeGreaterThan(450);
  expect(await second.evaluate((element) => element.clientHeight)).toBe(450);
  await collapse.click();
  expect(await first.evaluate((element) => element.clientHeight)).toBe(450);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});

test("mobile responses stack with bounded heights and no horizontal page overflow", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await compare(page);
  const regions = page.getByRole("region", { name: /^Response from/ });
  const cards = page.locator(".response-card");
  const positions = await cards.evaluateAll((elements) =>
    elements.map((element) => {
      const rect = element.getBoundingClientRect();
      return { top: rect.top, bottom: rect.bottom, left: rect.left };
    }),
  );
  expect(positions[1].top).toBeGreaterThan(positions[0].bottom);
  expect(positions[0].left).toBe(positions[1].left);
  for (const region of await regions.all()) {
    expect(await region.evaluate((element) => element.clientHeight)).toBe(320);
  }
  await page
    .getByRole("button", { name: /^Expand response from/ })
    .first()
    .click();
  expect(
    await regions.first().evaluate((element) => element.clientHeight),
  ).toBeGreaterThan(320);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.getByRole("button", { name: /^Collapse response from/ }).click();
  expect(
    await regions.first().evaluate((element) => element.clientHeight),
  ).toBe(320);
});
