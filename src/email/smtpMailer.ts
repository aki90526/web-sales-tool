import nodemailer from "nodemailer";

export type SmtpConfig = {
  host: string;
  port: number;
  user: string;
  pass: string;
  from: string;
  bcc?: string;
};

export type SendEmailInput = {
  to: string | string[];
  // 未指定なら設定(SMTP_BCC)を使い、空配列ならBCCなしで送る
  bcc?: string[];
  subject: string;
  text: string;
};

export const createSmtpMailer = (config: SmtpConfig) => {
  const transporter = nodemailer.createTransport({
    host: config.host,
    port: config.port,
    secure: config.port === 465,
    auth: {
      user: config.user,
      pass: config.pass
    }
  });

  return {
    verify: async (): Promise<void> => {
      await transporter.verify();
    },
    send: async (input: SendEmailInput): Promise<{ messageId: string }> => {
      const result = await transporter.sendMail({
        from: config.from,
        to: input.to,
        bcc: input.bcc === undefined ? config.bcc : input.bcc.length > 0 ? input.bcc : undefined,
        subject: input.subject,
        text: input.text
      });

      return {
        messageId: result.messageId
      };
    }
  };
};
