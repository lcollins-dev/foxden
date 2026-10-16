import { createTestUser } from '../factories/user.factory';
import { expect, test } from '../fixtures/test';
import { LOGGED_OUT_STORAGE_STATE } from '../utils/paths';
import { webRoute } from '../utils/urls';

const ADMIN_ROUTES = ['/admin/users', '/admin/invites', '/admin/jobs'];

test.use({ storageState: LOGGED_OUT_STORAGE_STATE });

test.describe('access control', () => {
  test('shows a user without roles the not-found page on every admin route, with no admin menu', async ({
    signInPage,
    page,
    request,
  }) => {
    const user = await createTestUser(request);

    await signInPage.signIn(user);
    const sideMenu = page.getByRole('navigation', { name: 'Main' });

    await expect(sideMenu.getByRole('link', { name: 'Devices', exact: true })).toBeVisible();

    for (const adminLink of ['Users', 'Invites', 'Background jobs']) {
      await expect(page.getByRole('link', { name: adminLink })).toHaveCount(0);
    }

    for (const adminSection of ['People', 'Server']) {
      await expect(sideMenu.getByText(adminSection, { exact: true })).toHaveCount(0);
    }

    for (const route of ADMIN_ROUTES) {
      await page.goto(webRoute(route));

      await expect(page).toHaveURL(new RegExp(`${route}$`));
      await expect(page.getByText('Page not found')).toBeVisible();
    }
  });

  test('sends a signed-out visitor to sign-in from an admin route', async ({ page }) => {
    await page.goto(webRoute('/admin/users'));

    await expect(page).toHaveURL(/\/sign-in/);
  });

  test('keeps a signed-in user off the sign-in page', async ({ signInPage, page, request }) => {
    const user = await createTestUser(request);

    await signInPage.signIn(user);

    await page.goto(webRoute('/sign-in'));

    await expect(page).toHaveURL(/\/getting-started$/);
  });
});
