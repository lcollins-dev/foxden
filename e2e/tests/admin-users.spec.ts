import { createTestUser } from '../factories/user.factory';
import { expect, test } from '../fixtures/test';
import { confirmDialog } from '../utils/dialog';

test.describe('admin users', () => {
  test('narrows the list to a searched user and opens it', async ({ adminUsersPage, adminUserPage, page, request }) => {
    const user = await createTestUser(request);
    const other = await createTestUser(request);

    await adminUsersPage.goto();
    await expect(adminUsersPage.heading).toBeVisible();

    await adminUsersPage.search(user.email);

    await expect(adminUsersPage.rowByEmail(user.email)).toBeVisible();
    await expect(adminUsersPage.rowByEmail(other.email)).toHaveCount(0);

    await adminUsersPage.rowByEmail(user.email).click();

    await expect(page).toHaveURL(new RegExp(`/admin/users/${user.id}$`));
    await expect(adminUserPage.email).toHaveText(user.email);
  });

  test('disables a user and shows it in the list filters', async ({ adminUserPage, adminUsersPage, page, request }) => {
    const user = await createTestUser(request);

    await adminUserPage.goto(user.id);
    await expect(adminUserPage.stateTag).toHaveText('Enabled');

    await adminUserPage.stateButton('Disable').click();
    await confirmDialog(page);

    await expect(page.getByText('Account disabled')).toBeVisible();
    await expect(adminUserPage.stateTag).toHaveText('Disabled');

    await adminUsersPage.goto();
    await adminUsersPage.search(user.email);

    await expect(adminUsersPage.rowByEmail(user.email)).toBeVisible();

    await adminUsersPage.filter('Enabled').click();

    await expect(adminUsersPage.rowByEmail(user.email)).toHaveCount(0);

    await adminUsersPage.filter('Disabled').click();

    await expect(adminUsersPage.rowByEmail(user.email)).toBeVisible();
  });

  test('makes a user an admin', async ({ adminUserPage, adminUsersPage, page, request }) => {
    const user = await createTestUser(request);

    await adminUserPage.goto(user.id);
    await adminUserPage.role('Admin').click();
    await confirmDialog(page);

    await expect(page.getByText(`${user.name} is now an admin.`)).toBeVisible();

    await adminUsersPage.goto();
    await adminUsersPage.search(user.email);
    await adminUsersPage.filter('Admin').click();

    await expect(adminUsersPage.rowByEmail(user.email)).toBeVisible();
  });

  test('deletes a user once their email is typed', async ({ adminUserPage, adminUsersPage, page, request }) => {
    const user = await createTestUser(request);

    await adminUserPage.goto(user.id);
    await adminUserPage.deleteButton.click();

    await expect(adminUserPage.confirmDeleteButton).toBeDisabled();

    await adminUserPage.deleteConfirmInput.fill(user.email);
    await adminUserPage.confirmDeleteButton.click();

    await expect(page).toHaveURL(/\/admin\/users$/);
    await expect(page.getByText(`${user.email} and its synced data were removed.`)).toBeVisible();

    await adminUsersPage.search(user.email);

    await expect(adminUsersPage.emptyState).toBeVisible();
    await expect(adminUsersPage.rowByEmail(user.email)).toHaveCount(0);
  });

  test('shows a notification raised over a dialog above it, where it can be closed', async ({
    adminUserPage,
    page,
    request,
    allowConsoleError,
  }) => {
    const user = await createTestUser(request);
    allowConsoleError(/components\/ui\/form\/CopyButton/);

    // A plain-HTTP LAN host has no clipboard, so copying fails and raises a notification while the dialog is open.
    await page.addInitScript(() => {
      Object.defineProperty(navigator, 'clipboard', { value: undefined });
    });

    await adminUserPage.goto(user.id);
    await adminUserPage.createResetLinkButton.click();
    await page.getByRole('dialog').getByRole('button', { name: 'Copy', exact: true }).click();

    const notification = page.getByTestId('notification-error');

    await expect(notification).toContainText("Couldn't copy");

    await notification.getByRole('button', { name: 'Close', exact: true }).click();

    await expect(notification).toHaveCount(0);
    await expect(page.getByRole('dialog')).toBeVisible();
  });
});
