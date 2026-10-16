import { Injectable, InternalServerErrorException, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { lstatSync, readFileSync } from 'fs';
import Handlebars from 'handlebars';
import juice from 'juice';
import { omit } from 'lodash';
import { Transporter, createTransport } from 'nodemailer';
import Mail from 'nodemailer/lib/mailer';
import SMTPTransport from 'nodemailer/lib/smtp-transport';
import { join } from 'path';

import { ConfigService } from '@/config/config.service';

interface IInviteValues {
  inviterName: string;
  serverHost: string;
  admin: boolean;
  link: string;
  expiresAt: number;
}

type EmailTemplateValues = IInviteValues;

export enum EmailTemplate {
  INVITE = 'invite.handlebars',
}

const SENDER_NAME = 'Foxden';

const DATE_TIME_FORMAT = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  timeZone: 'UTC',
  timeZoneName: 'short',
});

/** Registered as the `layout` partial, which every template's html part wraps its content in. */
const LAYOUT_FILE = 'layout.handlebars';

/** Attached inline and shown through its content id, since most email clients drop inline SVG and data URIs. */
const LOGO_FILE = 'foxden-logo.png';
const LOGO_CID = 'foxden-logo';

/** An admin's invite request waits on the send, so it fails in seconds rather than nodemailer's minutes. */
const SMTP_CONNECT_TIMEOUT_MS = 5_000;
const SMTP_SOCKET_TIMEOUT_MS = 10_000;

@Injectable()
export class EmailService implements OnApplicationBootstrap {
  private readonly logger = new Logger(EmailService.name);

  private readonly handlebars = Handlebars.create();

  private readonly templates: { [key: string]: Handlebars.TemplateDelegate } = {};

  private logo: Buffer | null = null;

  private transport: Transporter | null = null;

  constructor(private readonly configService: ConfigService) {}

  onApplicationBootstrap(): void {
    this.handlebars.registerPartial('layout', this.readTemplate(LAYOUT_FILE));
    this.handlebars.registerHelper('dateTime', (timestamp: number) => DATE_TIME_FORMAT.format(timestamp));

    for (const emailTemplate of Object.values(EmailTemplate)) {
      const emailTemplateContent = this.readTemplate(emailTemplate);

      try {
        this.templates[emailTemplate] = this.handlebars.compile(emailTemplateContent);
      } catch (error) {
        this.logger.error({ error, emailTemplate }, 'onApplicationBootstrap(): Failed to compile email template');
        throw new InternalServerErrorException();
      }
    }

    const logoPath = join(this.configService.emailTemplatesPath, 'assets', LOGO_FILE);

    try {
      this.logo = readFileSync(logoPath);
    } catch (error) {
      this.logger.error({ error, logoPath }, 'onApplicationBootstrap(): Failed to read the email logo');
      throw new InternalServerErrorException();
    }

    if (this.isConfigured()) {
      const username = this.configService.emailSmtpUsername.trim();

      this.transport = createTransport(
        new SMTPTransport({
          host: this.configService.emailSmtpHost,
          port: this.configService.emailSmtpPort,
          // An empty username still makes nodemailer attempt AUTH, which a relay that advertises it refuses.
          auth: username !== '' ? { user: username, pass: this.configService.emailSmtpPassword } : undefined,
          secure: this.configService.emailSmtpSecure,
          requireTLS: this.configService.emailSmtpStarttls,
          connectionTimeout: SMTP_CONNECT_TIMEOUT_MS,
          greetingTimeout: SMTP_CONNECT_TIMEOUT_MS,
          socketTimeout: SMTP_SOCKET_TIMEOUT_MS,
        })
      );
    }
  }

  isConfigured(): boolean {
    return this.configService.emailSmtpHost !== '';
  }

  /** Never throws: a failed or skipped send is logged and reported as false. */
  async sendEmail(
    toAddress: string,
    emailTemplate: EmailTemplate,
    values: EmailTemplateValues,
    replyTo?: string
  ): Promise<boolean> {
    if (!this.transport || !this.logo) {
      this.logger.log({ emailTemplate }, 'sendEmail(): Skipping email as no SMTP host is configured');
      return false;
    }

    try {
      const template = this.templates[emailTemplate];
      const subject = template({ subject: true, ...values }).trim();

      const message: Mail.Options = {
        from: { name: SENDER_NAME, address: this.configService.emailFromAddress },
        to: toAddress,
        replyTo,
        subject,
        text: template({ text: true, ...values }),
        // Many email clients ignore <style>, so the layout's stylesheet is inlined onto each element.
        html: juice(template({ html: true, title: subject, ...values })),
        attachments: [{ filename: LOGO_FILE, content: this.logo, cid: LOGO_CID }],
      };

      const response: unknown = await this.transport.sendMail(message);
      this.logger.log(
        { response: typeof response === 'object' ? omit(response, 'raw') : response },
        'sendEmail(): Successfully sent email'
      );

      return true;
    } catch (error) {
      this.logger.error({ error }, 'sendEmail(): Failed to send email');
    }

    return false;
  }

  private readTemplate(file: string): string {
    const templatePath = join(this.configService.emailTemplatesPath, file);

    try {
      if (lstatSync(templatePath).isFile()) {
        return readFileSync(templatePath).toString('utf-8');
      }
    } catch (error) {
      this.logger.error({ error, templatePath }, 'readTemplate(): Failed to read email template');
      throw new InternalServerErrorException();
    }

    this.logger.error({ templatePath }, 'readTemplate(): Email template is not a file');
    throw new InternalServerErrorException();
  }
}
