import { createInvite } from '../clients/admin.client';
import { createTestUser, uniqueEmail } from '../factories/user.factory';
import { expect, test } from '../fixtures/test';
import { LOGGED_OUT_STORAGE_STATE } from '../utils/paths';
import { BASE_URL, webRoute } from '../utils/urls';
import { TEST_PASSWORD } from '../utils/users';

test.use({ storageState: LOGGED_OUT_STORAGE_STATE });

test.describe('invite sign-up', () => {
  test('creates the account from an invite link and shows how to connect Firefox', async ({
    invitePage,
    connectFirefoxPage,
    page,
    request,
  }) => {
    const email = uniqueEmail('invited');
    const invite = await createInvite(request, email);

    await page.goto(invite.link);

    await expect(invitePage.email).toHaveValue(email);

    await invitePage.createAccount(TEST_PASSWORD);

    await expect(page).toHaveURL(/\/getting-started$/);
    await expect(connectFirefoxPage.root).toBeVisible();
    await expect(connectFirefoxPage.autoconfigUri).toHaveText(BASE_URL);
    await expect(connectFirefoxPage.allowHttpStep).toBeVisible();
  });

  test('refuses mismatched passwords before creating anything', async ({ invitePage, page, request }) => {
    const invite = await createInvite(request, uniqueEmail('mismatch'));

    await page.goto(invite.link);
    await invitePage.createAccount(TEST_PASSWORD, `${TEST_PASSWORD}-different`);

    await expect(invitePage.error).toHaveText("The passwords don't match.");
  });

  test('says an unknown invite link is not valid', async ({ invitePage, page }) => {
    await page.goto(webRoute(`/invite/${'0'.repeat(64)}`));

    await expect(invitePage.problem).toContainText("This Invite Link Isn't Valid");
  });

  test('says a used invite link has already been used', async ({ invitePage, page, request }) => {
    const user = await createTestUser(request);

    await page.goto(webRoute(`/invite/${user.inviteToken}`));

    await expect(invitePage.problem).toContainText('This Invite Has Already Been Used');
  });
});
