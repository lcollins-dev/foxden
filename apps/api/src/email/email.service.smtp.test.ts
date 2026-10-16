import { Test } from '@nestjs/testing';
import { AddressInfo, Server, Socket, createServer } from 'net';
import { join } from 'path';
import { afterEach, describe, expect, it } from 'vitest';

import { ConfigService } from '@/config/config.service';
import { EmailService, EmailTemplate } from '@/email/email.service';

// A file of its own, since email.service.test.ts mocks nodemailer for the whole file.
const TEMPLATES_PATH = join(__dirname, '../../email-templates');

const INVITE_VALUES = {
  inviterName: 'Sam Lee',
  serverHost: 'app.test',
  admin: false,
  link: 'https://app.test/invite/0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
  expiresAt: Date.parse('2026-10-07T09:00:00Z'),
};

interface ISmtpStub {
  port: number;
  commands: string[];
  messages: string[];
  close: () => Promise<void>;
}

const startSmtpStub = async (): Promise<ISmtpStub> => {
  const commands: string[] = [];
  const messages: string[] = [];
  const sockets = new Set<Socket>();

  const server: Server = createServer(socket => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));

    let buffer = '';
    let inData = false;
    const reply = (line: string): boolean => socket.write(`${line}\r\n`);

    reply('220 smtp.test ESMTP');

    socket.on('data', chunk => {
      buffer += chunk.toString('utf-8');

      for (;;) {
        if (inData) {
          const end = buffer.indexOf('\r\n.\r\n');

          if (end === -1) {
            return;
          }

          messages.push(buffer.slice(0, end + 2));
          buffer = buffer.slice(end + 5);
          inData = false;
          reply('250 OK');
          continue;
        }

        const eol = buffer.indexOf('\r\n');

        if (eol === -1) {
          return;
        }

        const line = buffer.slice(0, eol);
        buffer = buffer.slice(eol + 2);
        commands.push(line);

        const verb = line.slice(0, 4).toUpperCase();

        if (verb === 'EHLO') {
          reply('250-smtp.test');
          reply('250-AUTH PLAIN LOGIN');
          reply('250 8BITMIME');
        } else if (verb === 'STAR') {
          reply('502 5.5.1 STARTTLS not supported');
        } else if (verb === 'AUTH') {
          reply('235 Authentication successful');
        } else if (verb === 'DATA') {
          inData = true;
          reply('354 End data with <CR><LF>.<CR><LF>');
        } else if (verb === 'QUIT') {
          reply('221 Bye');
          socket.end();
        } else {
          reply('250 OK');
        }
      }
    });
  });

  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));

  return {
    port: (server.address() as AddressInfo).port,
    commands,
    messages,
    close: () =>
      new Promise<void>(resolve => {
        sockets.forEach(socket => socket.destroy());
        server.close(() => resolve());
      }),
  };
};

const decodeParts = (message: string): { contentType: string; headers: string; body: Buffer }[] => {
  const parts = message.split(/\r\n--[^\r\n]+\r\n/).slice(1);

  return parts
    .map(part => {
      const split = part.indexOf('\r\n\r\n');
      const headers = part.slice(0, split);
      const rawBody = part.slice(split + 4).replace(/\r\n--[^\r\n]+--\r\n?$/, '');
      const contentType = /^Content-Type: ([^;\r\n]+)/im.exec(headers)?.[1] ?? '';
      const encoding = /^Content-Transfer-Encoding: (\S+)/im.exec(headers)?.[1].toLowerCase();

      const body =
        encoding === 'base64'
          ? Buffer.from(rawBody, 'base64')
          : encoding === 'quoted-printable'
            ? Buffer.from(
                rawBody
                  .replace(/=\r\n/g, '')
                  .replace(/=([0-9A-F]{2})/g, (_match, hex: string) => String.fromCharCode(parseInt(hex, 16))),
                'latin1'
              )
            : Buffer.from(rawBody);

      return { contentType, headers, body };
    })
    .filter(part => !part.contentType.startsWith('multipart/'));
};

const buildService = async (port: number, overrides: Partial<Record<string, unknown>> = {}): Promise<EmailService> => {
  const config = {
    emailTemplatesPath: TEMPLATES_PATH,
    emailFromAddress: 'no-reply@app.test',
    emailSmtpHost: '127.0.0.1',
    emailSmtpPort: port,
    emailSmtpUsername: '',
    emailSmtpPassword: '',
    emailSmtpSecure: false,
    emailSmtpStarttls: false,
    ...overrides,
  };

  const moduleRef = await Test.createTestingModule({
    providers: [EmailService, { provide: ConfigService, useValue: config }],
  }).compile();

  const service = moduleRef.get(EmailService);
  service.onApplicationBootstrap();

  return service;
};

describe('EmailService over SMTP', () => {
  let stub: ISmtpStub | null = null;

  afterEach(async () => {
    await stub?.close();
    stub = null;
  });

  it('delivers the shipped invite as text and html, with the logo inline by content id', async () => {
    stub = await startSmtpStub();
    const service = await buildService(stub.port);

    const sent = await service.sendEmail('robin@example.com', EmailTemplate.INVITE, INVITE_VALUES);

    expect(sent).toBe(true);
    expect(stub.commands).toContain('MAIL FROM:<no-reply@app.test>');
    expect(stub.commands).toContain('RCPT TO:<robin@example.com>');
    expect(stub.messages).toHaveLength(1);

    const [message] = stub.messages;
    expect(message).toMatch(/^From: Foxden <no-reply@app\.test>$/m);
    expect(message).toMatch(/^Subject: Sam Lee invited you to Foxden$/m);

    const parts = decodeParts(message);
    const text = parts.find(part => part.contentType === 'text/plain')?.body.toString('utf-8');
    const html = parts.find(part => part.contentType === 'text/html')?.body.toString('utf-8');
    const logo = parts.find(part => part.contentType === 'image/png');

    expect(text).toContain(INVITE_VALUES.link);
    expect(text).toContain('7 Oct 2026, 09:00 UTC');
    expect(html).toContain(`href="${INVITE_VALUES.link}"`);
    expect(html).toContain('src="cid:foxden-logo"');
    expect(html).not.toContain('{{');
    expect(logo?.headers).toMatch(/^Content-ID: <foxden-logo>$/m);
    expect(logo?.body.subarray(0, 8)).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  });

  it('authenticates with the configured username', async () => {
    stub = await startSmtpStub();
    const service = await buildService(stub.port, { emailSmtpUsername: 'smtp-user', emailSmtpPassword: 'smtp-pass' });

    await service.sendEmail('robin@example.com', EmailTemplate.INVITE, INVITE_VALUES);

    expect(stub.commands).toContain(`AUTH PLAIN ${Buffer.from('\0smtp-user\0smtp-pass').toString('base64')}`);
  });

  it('sends no AUTH command when no username is configured, though the server offers AUTH', async () => {
    stub = await startSmtpStub();
    const service = await buildService(stub.port, { emailSmtpUsername: ' ' });

    const sent = await service.sendEmail('robin@example.com', EmailTemplate.INVITE, INVITE_VALUES);

    expect(sent).toBe(true);
    expect(stub.commands.filter(command => command.toUpperCase().startsWith('AUTH'))).toEqual([]);
  });

  it('reports failure when STARTTLS is required and the server does not offer it', async () => {
    stub = await startSmtpStub();
    const service = await buildService(stub.port, { emailSmtpStarttls: true });

    const sent = await service.sendEmail('robin@example.com', EmailTemplate.INVITE, INVITE_VALUES);

    expect(sent).toBe(false);
    expect(stub.messages).toEqual([]);
  });
});
