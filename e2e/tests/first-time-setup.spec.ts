import { DEFAULT_ADMIN, UserRoleId } from '@libs/dto';

import { createTestUser, uniqueEmail } from '../factories/user.factory';
import { expect, test } from '../fixtures/test';
import { requirePasswordChange } from '../utils/db';
import { LOGGED_OUT_STORAGE_STATE } from '../utils/paths';
import { webRoute } from '../utils/urls';

// Its own admin, flagged the way the server flags the default admin, which an instance with the seeded test admin
// never creates.
test.use({ storageState: LOGGED_OUT_STORAGE_STATE });

test.describe('first-time admin setup', () => {
  test('holds the admin on the setup screen until it has its own password, then opens the app', async ({
    signInPage,
    firstTimeSetupPage,
    headerMenu,
    page,
    request,
  }) => {
    const admin = await createTestUser(request, {
      name: 'Setup Admin',
      password: DEFAULT_ADMIN.password,
      userRoleIds: [UserRoleId.USER_ADMIN, UserRoleId.SYSTEM_ADMIN],
    });
    requirePasswordChange(admin.email);

    await signInPage.goto();
    await signInPage.enterCredentials(admin);

    await expect(page).toHaveURL(/\/setup$/);
    await expect(firstTimeSetupPage.heading).toBeVisible();
    await expect(firstTimeSetupPage.emailInput).toHaveValue(admin.email);

    await page.goto(webRoute('/admin/users'));
    await expect(page).toHaveURL(/\/setup$/);

    await firstTimeSetupPage.finish(DEFAULT_ADMIN.password);
    await expect(firstTimeSetupPage.error).toHaveText('Choose a password different from the current one.');
    await expect(page.getByText("You're using the default admin account")).toBeVisible();

    const newEmail = uniqueEmail('setup');
    const newPassword = 'a password of my own';

    await firstTimeSetupPage.emailInput.fill(newEmail);
    await firstTimeSetupPage.finish(newPassword);

    await expect(page).toHaveURL(/\/admin\/invites$/, { timeout: 30_000 });
    await expect(page.getByText('Next, invite the people who will use it.')).toBeVisible();

    await page.goto(webRoute('/admin/users'));
    await expect(page).toHaveURL(/\/admin\/users$/);

    await headerMenu.select('Sign out');
    await expect(page).toHaveURL(/\/sign-in/);

    await signInPage.signIn({ email: newEmail, password: newPassword });
  });
});
