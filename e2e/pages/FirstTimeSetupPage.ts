import { type Locator, type Page } from '@playwright/test';

export class FirstTimeSetupPage {
  constructor(private readonly page: Page) {}

  get heading(): Locator {
    return this.page.getByRole('heading', { name: 'Set up your server', exact: true });
  }

  get emailInput(): Locator {
    return this.page.locator('input[name="email"]');
  }

  get newPasswordInput(): Locator {
    return this.page.locator('input[name="new-password"]');
  }

  get confirmPasswordInput(): Locator {
    return this.page.locator('input[name="confirm-password"]');
  }

  get finishButton(): Locator {
    return this.page.getByRole('button', { name: 'Save and Continue', exact: true });
  }

  get error(): Locator {
    return this.page.getByTestId('field-error');
  }

  async finish(newPassword: string, confirmPassword = newPassword): Promise<void> {
    await this.newPasswordInput.fill(newPassword);
    await this.confirmPasswordInput.fill(confirmPassword);
    await this.finishButton.click();
  }
}
