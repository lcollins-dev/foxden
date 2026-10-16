import { createTestUser } from '../factories/user.factory';
import { expect, test } from '../fixtures/test';
import { LOGGED_OUT_STORAGE_STATE } from '../utils/paths';

// Its own user: the change ends every session of the account.
test.use({ storageState: LOGGED_OUT_STORAGE_STATE });

test.describe('password change', () => {
  test('keeps the web app signed in and makes only the new password work', async ({
    signInPage,
    accountSettingsPage,
    headerMenu,
    page,
    request,
    allowHttpError,
  }) => {
    const user = await createTestUser(request);
    const newPassword = 'a brand new password';
    allowHttpError({ url: /\/auth\/v1\/account\/login$/, status: 400 });

    await signInPage.signIn(user);
    await accountSettingsPage.goto();

    await accountSettingsPage.changePassword(user.password, newPassword);
    await expect(page.getByText('Sign in to Firefox Sync again on your other devices.')).toBeVisible({
      timeout: 30_000,
    });

    await page.reload();
    await expect(accountSettingsPage.nameInput).toHaveValue(user.name);

    await headerMenu.select('Sign out');
    await expect(page).toHaveURL(/\/sign-in/);

    await signInPage.enterCredentials(user);
    await expect(signInPage.error).toHaveText("That password isn't right. Try again.");

    await signInPage.passwordInput.fill(newPassword);
    await signInPage.submitButton.click();
    await expect(page).toHaveURL(/\/getting-started$/);
  });
});
