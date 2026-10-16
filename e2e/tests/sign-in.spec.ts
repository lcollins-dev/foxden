import { createTestUser, uniqueEmail } from '../factories/user.factory';
import { expect, test } from '../fixtures/test';
import { LOGGED_OUT_STORAGE_STATE } from '../utils/paths';
import { webRoute } from '../utils/urls';

test.use({ storageState: LOGGED_OUT_STORAGE_STATE });

test.describe('sign in', () => {
  test('redirects a protected route to sign-in when unauthenticated', async ({ page }) => {
    await page.goto(webRoute('/getting-started'));

    await expect(page).toHaveURL(/\/sign-in$/);
  });

  test('signs in with email then password and lands on Getting started', async ({ signInPage, page, request }) => {
    const user = await createTestUser(request);

    await signInPage.goto();
    await signInPage.enterCredentials(user);

    await expect(page).toHaveURL(/\/getting-started$/);
  });

  test("returns to the page Firefox's Manage devices link opened after sign-in", async ({
    signInPage,
    page,
    request,
  }) => {
    const user = await createTestUser(request);

    await page.goto(webRoute('/settings/clients?entrypoint=preferences&uid=abc'));
    await signInPage.enterCredentials(user);

    await expect(page).toHaveURL(/\/devices$/);
  });

  test('says the password is wrong and stays on sign-in', async ({ signInPage, page, request, allowHttpError }) => {
    const user = await createTestUser(request);
    allowHttpError({ url: /\/auth\/v1\/account\/login$/, status: 400 });

    await signInPage.goto();
    await signInPage.enterCredentials({ email: user.email, password: 'not-the-password' });

    await expect(signInPage.error).toHaveText("That password isn't right. Try again.");
    await expect(page).toHaveURL(/\/sign-in$/);
  });

  test('says accounts are invite-only for an unknown email', async ({ signInPage }) => {
    await signInPage.goto();
    await signInPage.enterEmail(uniqueEmail('unknown'));

    await expect(signInPage.error).toHaveText("There's no account for this email.");
    await expect(signInPage.inviteOnlyNotice).toContainText('Accounts are invite-only');
    await expect(signInPage.passwordInput).toHaveCount(0);
  });
});
