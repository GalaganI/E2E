import nodemailer from 'nodemailer';
import { serviceConfig } from './config';

const transport = nodemailer.createTransport({
  host: serviceConfig.smtpHost,
  port: serviceConfig.smtpPort,
  secure: false,
  ignoreTLS: true,
});

export interface OutgoingMail {
  to: string;
  subject: string;
  text: string;
  html: string;
  headers?: Record<string, string>;
  attachments?: { filename: string; content: string; contentType: string }[];
}

/** Sends mail to the local Mailpit SMTP server. Nothing leaves the machine. */
export async function sendMail(mail: OutgoingMail): Promise<void> {
  await transport.sendMail({ from: 'Demo Shop <no-reply@demo-shop.test>', ...mail });
}
