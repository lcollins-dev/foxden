import { createTestUser } from '../factories/user.factory';
import { expect, test } from '../fixtures/test';

test.describe('password reset', () => {
  test('an admin makes a reset link and the user resets their password with it', async ({
    adminUserPage,
    resetPasswordPage,
    connectFirefoxPage,
    page,
    request,
  }) => {
    const user = await createTestUser(request);

    await adminUserPage.goto(user.id);
    await adminUserPage.createResetLinkButton.click();

    const link = (await adminUserPage.resetLink.textContent()) ?? '';
    expect(link).toMatch(/\/reset-password\/[0-9a-f]{64}$/);

    await page.getByRole('button', { name: 'Done', exact: true }).click();
    await expect(adminUserPage.resetRow).toContainText('A reset link is waiting to be used.');

    // The user opens the link in their own browser, signed out.
    await page.evaluate(() => {
      localStorage.clear();
    });
    await page.goto(link);

    await expect(resetPasswordPage.email).toHaveValue(user.email);

    await resetPasswordPage.resetPassword('a brand new password');

    await expect(page).toHaveURL(/\/getting-started$/);
    await expect(connectFirefoxPage.root).toBeVisible();
    await expect(page.getByText('Password reset', { exact: true })).toBeVisible();
  });
});
