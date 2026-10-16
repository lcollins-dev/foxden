import { type Locator, type Page } from '@playwright/test';

import { webRoute } from '../utils/urls';

export class ConnectFirefoxPage {
  constructor(private readonly page: Page) {}

  get heading(): Locator {
    return this.page.getByRole('heading', { name: 'Getting started', exact: true });
  }

  get root(): Locator {
    return this.page.getByTestId('connect-firefox');
  }

  get autoconfigUri(): Locator {
    return this.page.getByTestId('autoconfig-uri');
  }

  get allowHttpStep(): Locator {
    return this.page.getByTestId('allow-http-step');
  }

  async goto(): Promise<void> {
    await this.page.goto(webRoute('/getting-started'));
  }
}
