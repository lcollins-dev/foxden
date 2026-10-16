import { InternalServerErrorException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { lstatSync, readFileSync } from 'fs';
import { createTransport } from 'nodemailer';
import SMTPTransport from 'nodemailer/lib/smtp-transport';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ConfigService } from '@/config/config.service';
import { EmailService, EmailTemplate } from '@/email/email.service';

vi.mock('fs', () => ({
  lstatSync: vi.fn(),
  readFileSync: vi.fn(),
}));

vi.mock('nodemailer', () => ({
  createTransport: vi.fn(),
}));

const LAYOUT_SOURCE =
  '<html><head><title>{{title}}</title><style>p { color: red; }</style></head><body>{{> @partial-block}}</body></html>';

const TEMPLATE_SOURCE =
  '{{#if subject}}Invite{{/if}}{{#if text}}Sign up at {{link}} before {{dateTime expiresAt}}{{/if}}' +
  '{{#if html}}{{#> layout}}<p>{{link}}</p>{{/layout}}{{/if}}';

const LOGO = Buffer.from('logo');

const FILES: Record<string, Buffer<ArrayBuffer>> = {
  '/srv/templates/layout.handlebars': Buffer.from(LAYOUT_SOURCE),
  [`/srv/templates/${EmailTemplate.INVITE}`]: Buffer.from(TEMPLATE_SOURCE),
  '/srv/templates/assets/foxden-logo.png': LOGO,
};

const readFixture = (path: unknown): Buffer<ArrayBuffer> => {
  const file = typeof path === 'string' ? FILES[path] : undefined;

  if (!file) {
    throw new Error('ENOENT');
  }

  return file;
};

const INVITE_VALUES = {
  inviterName: 'Sam Lee',
  serverHost: 'app.test',
  admin: false,
  link: 'https://app.test/invite/abc',
  expiresAt: Date.parse('2026-10-07T09:00:00Z'),
};

interface IConfigMock {
  emailTemplatesPath: string;
  emailFromAddress: string;
  emailSmtpHost: string;
  emailSmtpPort: number;
  emailSmtpUsername: string;
  emailSmtpPassword: string;
  emailSmtpSecure: boolean;
  emailSmtpStarttls: boolean;
}

const buildConfigMock = (overrides: Partial<IConfigMock> = {}): IConfigMock => ({
  emailTemplatesPath: '/srv/templates',
  emailFromAddress: 'no-reply@app.test',
  emailSmtpHost: 'smtp.test',
  emailSmtpPort: 587,
  emailSmtpUsername: 'smtp-user',
  emailSmtpPassword: 'smtp-pass',
  emailSmtpSecure: false,
  emailSmtpStarttls: true,
  ...overrides,
});

const buildService = async (config: IConfigMock): Promise<EmailService> => {
  const moduleRef = await Test.createTestingModule({
    providers: [EmailService, { provide: ConfigService, useValue: config }],
  }).compile();

  return moduleRef.get(EmailService);
};

describe('EmailService', () => {
  let sendMailMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.mocked(lstatSync)
      .mockReset()
      .mockReturnValue({ isFile: () => true } as ReturnType<typeof lstatSync>);
    vi.mocked(readFileSync).mockReset().mockImplementation(readFixture);

    sendMailMock = vi.fn().mockResolvedValue({ messageId: 'abc' });
    vi.mocked(createTransport)
      .mockReset()
      .mockReturnValue({ sendMail: sendMailMock } as unknown as ReturnType<typeof createTransport>);
  });

  describe('onApplicationBootstrap', () => {
    it('reads every template from the configured directory', async () => {
      const service = await buildService(buildConfigMock());

      service.onApplicationBootstrap();

      expect(lstatSync).toHaveBeenCalledWith('/srv/templates/layout.handlebars');
      expect(lstatSync).toHaveBeenCalledWith(`/srv/templates/${EmailTemplate.INVITE}`);
    });

    it('throws when a template path is not a file', async () => {
      vi.mocked(lstatSync).mockReturnValue({ isFile: () => false } as ReturnType<typeof lstatSync>);

      const service = await buildService(buildConfigMock());

      expect(() => service.onApplicationBootstrap()).toThrow(InternalServerErrorException);
    });

    it('throws when a template cannot be read', async () => {
      vi.mocked(readFileSync).mockImplementation(() => {
        throw new Error('EACCES');
      });

      const service = await buildService(buildConfigMock());

      expect(() => service.onApplicationBootstrap()).toThrow(InternalServerErrorException);
    });

    it('throws when the logo cannot be read', async () => {
      vi.mocked(readFileSync).mockImplementation(path => {
        if (path === '/srv/templates/assets/foxden-logo.png') {
          throw new Error('ENOENT');
        }

        return readFixture(path);
      });

      const service = await buildService(buildConfigMock());

      expect(() => service.onApplicationBootstrap()).toThrow(InternalServerErrorException);
    });

    it('builds an smtp transport when an smtp host is configured', async () => {
      const service = await buildService(buildConfigMock());

      service.onApplicationBootstrap();

      expect(vi.mocked(createTransport).mock.calls[0][0]).toBeInstanceOf(SMTPTransport);
    });

    it('authenticates with the configured username, and gives up on an unresponsive server within seconds', async () => {
      const service = await buildService(buildConfigMock());

      service.onApplicationBootstrap();

      const { options } = vi.mocked(createTransport).mock.calls[0][0] as SMTPTransport;

      expect(options.auth).toEqual({ user: 'smtp-user', pass: 'smtp-pass' });
      expect(options.connectionTimeout).toBeLessThanOrEqual(10_000);
      expect(options.greetingTimeout).toBeLessThanOrEqual(10_000);
      expect(options.socketTimeout).toBeLessThanOrEqual(10_000);
    });

    it('sends no credentials when no username is configured', async () => {
      const service = await buildService(buildConfigMock({ emailSmtpUsername: ' ', emailSmtpPassword: '' }));

      service.onApplicationBootstrap();

      const { options } = vi.mocked(createTransport).mock.calls[0][0] as SMTPTransport;

      expect(options.auth).toBeUndefined();
    });

    it('builds no transport when no smtp host is configured', async () => {
      const service = await buildService(buildConfigMock({ emailSmtpHost: '' }));

      service.onApplicationBootstrap();

      expect(createTransport).not.toHaveBeenCalled();
    });
  });

  describe('isConfigured', () => {
    it('reports whether an smtp host is set', async () => {
      expect((await buildService(buildConfigMock())).isConfigured()).toBe(true);
      expect((await buildService(buildConfigMock({ emailSmtpHost: '' }))).isConfigured()).toBe(false);
    });
  });

  describe('sendEmail', () => {
    it('reports failure rather than throwing when no smtp host is configured', async () => {
      const service = await buildService(buildConfigMock({ emailSmtpHost: '' }));
      service.onApplicationBootstrap();

      const sent = await service.sendEmail('user@example.com', EmailTemplate.INVITE, INVITE_VALUES);

      expect(sent).toBe(false);
    });

    it('reports failure rather than throwing when the transport has not been built', async () => {
      const service = await buildService(buildConfigMock());

      const sent = await service.sendEmail('user@example.com', EmailTemplate.INVITE, INVITE_VALUES);

      expect(sent).toBe(false);
    });

    it('renders each part from the one template, the html inside the layout with its css inlined', async () => {
      const service = await buildService(buildConfigMock());
      service.onApplicationBootstrap();

      await service.sendEmail('user@example.com', EmailTemplate.INVITE, INVITE_VALUES, 'sam@example.com');

      expect(sendMailMock).toHaveBeenCalledWith({
        from: { name: 'Foxden', address: 'no-reply@app.test' },
        to: 'user@example.com',
        replyTo: 'sam@example.com',
        subject: 'Invite',
        text: 'Sign up at https://app.test/invite/abc before 7 Oct 2026, 09:00 UTC',
        html:
          '<html><head><title>Invite</title></head>' +
          '<body><p style="color: red;">https://app.test/invite/abc</p></body></html>',
        attachments: [{ filename: 'foxden-logo.png', content: LOGO, cid: 'foxden-logo' }],
      });
    });

    it('reports success when the transport accepts the message', async () => {
      const service = await buildService(buildConfigMock());
      service.onApplicationBootstrap();

      const sent = await service.sendEmail('user@example.com', EmailTemplate.INVITE, INVITE_VALUES);

      expect(sent).toBe(true);
    });

    it('reports failure rather than throwing when the transport rejects', async () => {
      sendMailMock.mockRejectedValue(new Error('connection refused'));

      const service = await buildService(buildConfigMock());
      service.onApplicationBootstrap();

      const sent = await service.sendEmail('user@example.com', EmailTemplate.INVITE, INVITE_VALUES);

      expect(sent).toBe(false);
    });
  });
});
