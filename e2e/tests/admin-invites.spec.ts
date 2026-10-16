import { uniqueEmail } from '../factories/user.factory';
import { expect, test } from '../fixtures/test';
import { confirmDialog } from '../utils/dialog';

test.describe('admin invites', () => {
  test('refuses a short name, creates an invite, lists it as pending, refuses a second one and revokes it', async ({
    adminUsersPage,
    invitesPage,
    page,
    allowHttpError,
  }) => {
    const email = uniqueEmail('invited');
    allowHttpError({ url: /\/api\/v1\/admin\/invite$/, status: 400 });

    await adminUsersPage.goto();
    await adminUsersPage.inviteButton.click();

    await expect(page).toHaveURL(/\/admin\/invites$/);
    await expect(invitesPage.heading).toBeVisible();

    await invitesPage.createInvite(email, 'R');

    await expect(invitesPage.nameError).toBeVisible();
    await expect(invitesPage.inviteLink).toHaveCount(0);

    await invitesPage.createInvite(email, 'Robin Ash');

    await expect(invitesPage.inviteLink).toHaveText(/\/invite\/[0-9a-f]{64}$/);
    await expect(invitesPage.emailStatus).toHaveText(/Emailed to|send it yourself/);
    await expect(invitesPage.pendingInvite(email)).toContainText('Robin Ash');

    await invitesPage.doneButton.click();

    await expect(invitesPage.inviteLink).toHaveCount(0);

    await invitesPage.createInvite(email);

    await expect(invitesPage.createError).toHaveText(
      'This email already has a pending invite. Revoke it below to send a new one.'
    );

    await invitesPage.pendingInvite(email).getByRole('button', { name: 'Revoke' }).click();
    await confirmDialog(page);

    await expect(page.getByText(`The link for ${email} no longer works.`)).toBeVisible();
    await expect(invitesPage.pendingInvite(email)).toHaveCount(0);
  });
});
