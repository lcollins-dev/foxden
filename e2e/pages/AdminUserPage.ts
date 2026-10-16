import { type Locator, type Page } from '@playwright/test';

import { webRoute } from '../utils/urls';

export class AdminUserPage {
  constructor(private readonly page: Page) {}

  get email(): Locator {
    return this.page.getByTestId('user-email');
  }

  get stateTag(): Locator {
    return this.page.getByTestId('user-state');
  }

  role(label: 'User' | 'Admin'): Locator {
    return this.page.getByRole('radio', { name: label, exact: true });
  }

  stateButton(label: 'Disable' | 'Enable'): Locator {
    return this.page.getByRole('button', { name: label, exact: true });
  }

  get createResetLinkButton(): Locator {
    return this.page.getByRole('button', { name: 'Create Reset Link', exact: true });
  }

  get resetLink(): Locator {
    return this.page.getByTestId('password-reset-link');
  }

  get resetRow(): Locator {
    return this.page.getByTestId('password-reset-row');
  }

  get deleteButton(): Locator {
    return this.page.getByRole('button', { name: 'Delete Account', exact: true }).first();
  }

  get deleteDialog(): Locator {
    return this.page.getByRole('dialog');
  }

  get deleteConfirmInput(): Locator {
    return this.deleteDialog.locator('input[name="confirm-text"]');
  }

  get confirmDeleteButton(): Locator {
    return this.deleteDialog.getByRole('button', { name: 'Delete Account', exact: true });
  }

  async goto(userId: number): Promise<void> {
    await this.page.goto(webRoute(`/admin/users/${userId}`));
  }
}
