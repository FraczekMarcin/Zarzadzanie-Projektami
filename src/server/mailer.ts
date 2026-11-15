import nodemailer from 'nodemailer';
import type { SettingsService } from './settings.js';

export interface SendMailInput {
  to: string | string[];
  subject: string;
  text: string;
  html?: string;
}

export interface MailerService {
  isMailConfigured: () => boolean;
  sendMail: (mail: SendMailInput) => Promise<void>;
}

export function scrubSecretFromText(text: string, secret?: string): string {
  let result = String(text || '');
  if (secret && secret.length > 0) {
    result = result.split(secret).join('[UKRYTE]');
  }
  return result;
}

export function formatSmtpErrorPolish(err: any, smtpPassword?: string): string {
  const code = String(err?.code || '').toUpperCase();
  const responseCode = typeof err?.responseCode === 'number' ? err.responseCode : 0;
  const rawMessage = scrubSecretFromText(
    String(err?.message || err || 'Nieznany błąd serwera SMTP'),
    smtpPassword
  );
  const lower = rawMessage.toLowerCase();

  if (code === 'ENOTFOUND' || code === 'EAI_AGAIN' || code === 'EDNS') {
    return 'Nie można odnaleźć serwera SMTP (błąd DNS — sprawdź adres serwera).';
  }
  if (code === 'ECONNREFUSED') {
    return 'Serwer SMTP odrzucił połączenie (sprawdź adres hosta i numer portu).';
  }
  if (code === 'ETIMEDOUT' || code === 'ESOCKETTIMEDOUT' || lower.includes('timeout')) {
    return 'Przekroczono limit czasu połączenia z serwerem SMTP (timeout).';
  }
  if (
    code === 'EAUTH' ||
    responseCode === 535 ||
    responseCode === 534 ||
    lower.includes('invalid login') ||
    lower.includes('authentication failed') ||
    lower.includes('username and password not accepted')
  ) {
    return 'Błąd uwierzytelniania SMTP — sprawdź nazwę użytkownika i hasło.';
  }
  if (
    code === 'DEPTH_ZERO_SELF_SIGNED_CERT' ||
    code === 'SELF_SIGNED_CERT_IN_CHAIN' ||
    code === 'ERR_TLS_CERT_ALTNAME_INVALID' ||
    code === 'UNABLE_TO_VERIFY_LEAF_SIGNATURE' ||
    code === 'CERT_HAS_EXPIRED' ||
    lower.includes('self-signed certificate') ||
    lower.includes('self signed certificate') ||
    lower.includes('certificate') ||
    lower.includes('unable to verify')
  ) {
    return 'Błąd weryfikacji certyfikatu TLS serwera SMTP (certyfikat samopodpisany lub niezaufany).';
  }

  return `Błąd wysyłki wiadomości SMTP: ${rawMessage}`;
}

export function createMailer(settingsService: SettingsService): MailerService {
  function isMailConfigured(): boolean {
    return settingsService.getRuntimeSmtpConfig().configured;
  }

  async function sendMail(mail: SendMailInput): Promise<void> {
    const smtp = settingsService.getRuntimeSmtpConfig();
    if (!smtp.configured || !smtp.host) {
      throw new Error('Serwer SMTP nie jest skonfigurowany.');
    }

    const transportOptions: any = {
      host: smtp.host,
      port: smtp.port,
      connectionTimeout: 10000,
      greetingTimeout: 10000,
      socketTimeout: 15000,
      auth: smtp.user
        ? {
            user: smtp.user,
            pass: smtp.password || '',
          }
        : undefined,
    };

    if (smtp.encryption === 'tls') {
      transportOptions.secure = true;
    } else if (smtp.encryption === 'starttls') {
      transportOptions.secure = false;
      transportOptions.requireTLS = true;
    } else {
      // 'none'
      transportOptions.secure = false;
      transportOptions.ignoreTLS = true;
    }

    if (smtp.allowSelfSigned && smtp.encryption !== 'none') {
      transportOptions.tls = { rejectUnauthorized: false };
    }

    const transporter = nodemailer.createTransport(transportOptions);
    const recipients = Array.isArray(mail.to) ? mail.to.join(', ') : mail.to;

    await transporter.sendMail({
      from: smtp.from,
      to: recipients,
      subject: mail.subject,
      text: mail.text,
      html: mail.html,
    });
  }

  return {
    isMailConfigured,
    sendMail,
  };
}
