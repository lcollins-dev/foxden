import { expect, test } from '../fixtures/test';
import { webRoute } from '../utils/urls';

test.describe('page not found', () => {
  test('shows the not-found page and offers a way home', async ({ page }) => {
    await page.goto(webRoute('/a-route-that-does-not-exist'));

    await expect(page.getByText('Page not found')).toBeVisible();

    await page.getByRole('link', { name: 'Go Home', exact: true }).click();

    await expect(page).toHaveURL(/\/getting-started$/);
  });
});
