import { signInElsewhere, signInFirefoxDevice } from '../clients/firefox.client';
import { createTestUser } from '../factories/user.factory';
import { expect, test } from '../fixtures/test';
import { confirmDialog } from '../utils/dialog';
import { LOGGED_OUT_STORAGE_STATE } from '../utils/paths';

// Its own user: the spec signs that account's other sessions out.
test.use({ storageState: LOGGED_OUT_STORAGE_STATE });

test.describe('devices', () => {
  test('lists the Firefox and web sessions, signs one out, then all the others', async ({
    signInPage,
    devicesPage,
    page,
    request,
  }) => {
    const user = await createTestUser(request);

    await signInFirefoxDevice(request, user, "Sam's MacBook Pro");
    await signInElsewhere(user);
    await signInPage.signIn(user);
    await devicesPage.goto();

    await expect(devicesPage.firefoxRows).toHaveCount(1);
    await expect(devicesPage.firefoxRows.first()).toContainText("Sam's MacBook Pro");
    await expect(devicesPage.webRows).toHaveCount(2);
    await expect(devicesPage.webRows.filter({ hasText: 'This device' })).toHaveCount(1);

    await devicesPage.signOutButton(devicesPage.firefoxRows.first()).click();
    await confirmDialog(page);

    await expect(page.getByText("Sam's MacBook Pro will stop syncing until you sign in again.")).toBeVisible();
    await expect(devicesPage.firefoxRows).toHaveCount(0);

    await devicesPage.signOutOthersButton.click();
    await confirmDialog(page);

    await expect(page.getByText('1 device was signed out.')).toBeVisible();
    await expect(devicesPage.webRows).toHaveCount(1);

    await page.reload();
    await expect(devicesPage.webRows).toHaveCount(1);
  });
});
