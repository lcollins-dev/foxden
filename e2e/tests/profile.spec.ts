import { createTestUser } from '../factories/user.factory';
import { expect, test } from '../fixtures/test';
import { LOGGED_OUT_STORAGE_STATE } from '../utils/paths';

// Its own user: the profile edit renames whoever is signed in, and the shared admin is
// the account every other authenticated spec relies on.
test.use({ storageState: LOGGED_OUT_STORAGE_STATE });

test.describe('account settings', () => {
  test('renames the signed-in user and keeps the new name after a reload', async ({
    signInPage,
    accountSettingsPage,
    headerMenu,
    page,
    request,
  }) => {
    const user = await createTestUser(request);

    await signInPage.signIn(user);
    await accountSettingsPage.goto();

    await expect(accountSettingsPage.nameInput).toHaveValue(user.name);
    await expect(accountSettingsPage.saveButton).toBeDisabled();

    await accountSettingsPage.nameInput.fill('Renamed In E2E');
    await accountSettingsPage.saveButton.click();

    await expect(page.getByText('Your changes have been saved.')).toBeVisible();

    await page.reload();

    await expect(accountSettingsPage.nameInput).toHaveValue('Renamed In E2E');
    await expect(headerMenu.userMenu).toContainText('Renamed In E2E');
  });
});
