import { type Locator, type Page } from '@playwright/test';

import { confirmDialog } from '../utils/dialog';
import { webRoute } from '../utils/urls';

export class AccountSettingsPage {
  constructor(private readonly page: Page) {}

  get nameInput(): Locator {
    return this.page.locator('input[name="display-name"]');
  }

  get saveButton(): Locator {
    return this.page.getByRole('button', { name: 'Save', exact: true });
  }

  get currentPasswordInput(): Locator {
    return this.page.locator('input[name="current-password"]');
  }

  get newPasswordInput(): Locator {
    return this.page.locator('input[name="new-password"]');
  }

  get confirmPasswordInput(): Locator {
    return this.page.locator('input[name="confirm-password"]');
  }

  get changePasswordButton(): Locator {
    return this.page.getByRole('button', { name: 'Change Password', exact: true });
  }

  async goto(): Promise<void> {
    await this.page.goto(webRoute('/profile-and-security'));
  }

  async changePassword(currentPassword: string, newPassword: string): Promise<void> {
    await this.currentPasswordInput.fill(currentPassword);
    await this.newPasswordInput.fill(newPassword);
    await this.confirmPasswordInput.fill(newPassword);
    await this.changePasswordButton.click();
    await confirmDialog(this.page);
  }
}
