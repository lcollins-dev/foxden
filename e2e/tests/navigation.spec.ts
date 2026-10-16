import { expect, test } from '../fixtures/test';
import { webRoute } from '../utils/urls';

test.describe('navigation', () => {
  test('opens the app on Getting started from the root', async ({ connectFirefoxPage, page }) => {
    await page.goto(webRoute('/'));

    await expect(page).toHaveURL(/\/getting-started$/);
    await expect(connectFirefoxPage.heading).toBeVisible();
  });

  test('moves between the screens from the side menu', async ({ page }) => {
    await page.goto(webRoute('/getting-started'));

    await page.getByRole('link', { name: 'Devices', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Devices', exact: true })).toBeVisible();

    await page.getByRole('link', { name: 'Background jobs', exact: true }).click();
    await expect(page).toHaveURL(/\/admin\/jobs$/);
  });
});
