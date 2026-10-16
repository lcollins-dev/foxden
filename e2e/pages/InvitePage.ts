import { type Locator, type Page } from '@playwright/test';

export class InvitePage {
  constructor(private readonly page: Page) {}

  get email(): Locator {
    return this.page.locator('input[name="email"]');
  }

  get passwordInput(): Locator {
    return this.page.locator('input[name="password"]');
  }

  get confirmPasswordInput(): Locator {
    return this.page.locator('input[name="confirm-password"]');
  }

  get submitButton(): Locator {
    return this.page.getByRole('button', { name: 'Create Account', exact: true });
  }

  get error(): Locator {
    return this.page.getByTestId('field-error');
  }

  get problem(): Locator {
    return this.page.getByTestId('invite-problem');
  }

  async createAccount(password: string, confirmPassword = password): Promise<void> {
    await this.passwordInput.fill(password);
    await this.confirmPasswordInput.fill(confirmPassword);
    await this.submitButton.click();
  }
}
