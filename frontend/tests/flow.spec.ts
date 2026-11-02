import { test, expect } from "@playwright/test";

test("keeps history available when leaderboard loading fails", async ({
  page,
}) => {
  await page.goto("/");
  await page
    .getByLabel("What would you like to explore?")
    .fill("A saved comparison");
  await page.getByRole("button", { name: "Compare responses" }).click();
  await expect(
    page.getByText("Test response from", { exact: false }),
  ).toHaveCount(2);

  await page.route("**/api/leaderboard", (route) =>
    route.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({ detail: "Leaderboard temporarily unavailable" }),
    }),
  );
  await page.reload();
  await expect(page.getByRole("alert")).toContainText(
    "Leaderboard temporarily unavailable",
  );
  await page
    .getByRole("button")
    .filter({ hasText: "A saved comparison" })
    .click();
  await expect(
    page.getByText("Test response from", { exact: false }),
  ).toHaveCount(2);
});

test("prevents a new submission or history switch while a vote is pending", async ({
  page,
}) => {
  await page.goto("/");
  await page
    .getByLabel("What would you like to explore?")
    .fill("A pending vote");
  await page.getByRole("button", { name: "Compare responses" }).click();
  await expect(
    page.getByText("Test response from", { exact: false }),
  ).toHaveCount(2);

  let releaseVote!: () => void;
  const gate = new Promise<void>((resolve) => {
    releaseVote = resolve;
  });
  let voteStarted!: () => void;
  const started = new Promise<void>((resolve) => {
    voteStarted = resolve;
  });
  await page.route("**/votes", async (route) => {
    voteStarted();
    await gate;
    await route.continue();
  });
  try {
    await page
      .getByRole("button", { name: "Vote for this response" })
      .first()
      .click();
    await started;
    await expect(
      page.getByRole("button", { name: "Compare responses" }),
    ).toBeDisabled();
    await expect(
      page.getByRole("button").filter({ hasText: "A pending vote" }),
    ).toBeDisabled();
  } finally {
    releaseVote();
  }
  await expect(
    page.getByRole("button", { name: "Your preferred response" }),
  ).toBeDisabled();
  await expect(
    page.getByRole("button", { name: "Compare responses" }),
  ).toBeEnabled();
});

test("compare, vote, and return in a new browser session", async ({
  browser,
  baseURL,
}) => {
  let context = await browser.newContext({ baseURL });
  let page = await context.newPage();
  try {
    await page.goto("/");
    await page
      .getByLabel("What would you like to explore?")
      .fill("Explain gravity simply");
    await page.getByRole("button", { name: "Compare responses" }).click();
    await expect(
      page.getByText("Test response from", { exact: false }),
    ).toHaveCount(2);
    const votes = page.getByRole("button", { name: "Vote for this response" });
    await expect(votes).toHaveCount(2);
    await votes.first().click();
    await expect(
      page.getByRole("button", { name: "Your preferred response" }),
    ).toBeDisabled();
    await expect(
      page.getByText("Vote recorded. Thank you for contributing."),
    ).toBeVisible();
    // Restore the same origin storage into a fresh context to represent a return visit.
    const storedIdentity = await page.evaluate(() =>
      localStorage.getItem("llm-browser-id"),
    );
    const state = await context.storageState();
    await context.close();
    context = await browser.newContext({ baseURL, storageState: state });
    page = await context.newPage();
    await page.goto("/");
    expect(
      await page.evaluate(() => localStorage.getItem("llm-browser-id")),
    ).toBe(storedIdentity);
    await page
      .getByRole("button")
      .filter({ hasText: "Explain gravity simply" })
      .click();
    await expect(
      page.getByRole("button", { name: "Your preferred response" }),
    ).toBeDisabled();
    await expect(
      page.getByText("Test response from", { exact: false }),
    ).toHaveCount(2);
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(
      page.getByRole("heading", { name: "The comparison" }),
    ).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({ path: "test-results/mobile.png", fullPage: true });
  } finally {
    await context.close();
  }
});

test("shows a useful error for a non-JSON server failure", async ({ page }) => {
  await page.route("**/api/comparisons", (route) =>
    route.fulfill({
      status: 502,
      contentType: "text/plain",
      body: "Bad gateway",
    }),
  );
  await page.goto("/");
  await page
    .getByLabel("What would you like to explore?")
    .fill("Explain gravity");
  await page.getByRole("button", { name: "Compare responses" }).click();
  await expect(page.getByRole("alert")).toContainText(
    "The server could not complete the request",
  );
});

test("shows a useful backend error without losing the prompt", async ({
  page,
}) => {
  await page.route("**/api/comparisons", (route) =>
    route.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({
        detail: "Set GEMINI_API_KEY in backend/.env before comparing models.",
      }),
    }),
  );
  await page.goto("/");
  const prompt = page.getByLabel("What would you like to explore?");
  await prompt.fill("A retained prompt");
  await page.getByRole("button", { name: "Compare responses" }).click();
  await expect(page.getByRole("alert")).toContainText("Set GEMINI_API_KEY");
  await expect(prompt).toHaveValue("A retained prompt");
  await expect(
    page.getByRole("button", { name: "Compare responses" }),
  ).toBeEnabled();
});
