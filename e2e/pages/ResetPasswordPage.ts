import { type Locator, type Page } from '@playwright/test';

export class ResetPasswordPage {
  constructor(private readonly page: Page) {}

  get email(): Locator {
    return this.page.locator('input[name="email"]');
  }

  get understood(): Locator {
    return this.page.getByTestId('reset-password-understood');
  }

  get submitButton(): Locator {
    return this.page.getByRole('button', { name: 'Reset Password', exact: true });
  }

  get problem(): Locator {
    return this.page.getByTestId('reset-password-problem');
  }

  async resetPassword(password: string): Promise<void> {
    await this.page.locator('input[name="password"]').fill(password);
    await this.page.locator('input[name="confirm-password"]').fill(password);
    await this.understood.click();
    await this.submitButton.click();
  }
}
