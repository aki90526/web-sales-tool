import dotenv from "dotenv";

dotenv.config();

export type AppConfig = {
  googleSpreadsheetId: string;
  googleServiceAccountEmail: string;
  googlePrivateKey: string;
  openAiApiKey?: string;
  openAiModel: string;
  smtp?: {
    host: string;
    port: number;
    user: string;
    pass: string;
    from: string;
    bcc?: string;
  };
};

const requiredEnv = (name: string): string => {
  const value = process.env[name];

  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }

  return value;
};

const normalizePrivateKey = (value: string): string => {
  return value.replace(/\\n/g, "\n");
};

export const loadConfig = (): AppConfig => {
  const smtpPort = process.env.SMTP_PORT ? Number(process.env.SMTP_PORT) : undefined;
  const hasSmtpConfig = Boolean(
    process.env.SMTP_HOST ||
      process.env.SMTP_PORT ||
      process.env.SMTP_USER ||
      process.env.SMTP_PASS ||
      process.env.SMTP_FROM ||
      process.env.SMTP_BCC
  );

  return {
    googleSpreadsheetId: requiredEnv("GOOGLE_SPREADSHEET_ID"),
    googleServiceAccountEmail: requiredEnv("GOOGLE_SERVICE_ACCOUNT_EMAIL"),
    googlePrivateKey: normalizePrivateKey(requiredEnv("GOOGLE_PRIVATE_KEY")),
    openAiApiKey: process.env.OPENAI_API_KEY,
    openAiModel: process.env.OPENAI_MODEL ?? "gpt-5.6-luna",
    smtp: hasSmtpConfig
      ? {
          host: requiredEnv("SMTP_HOST"),
          port:
            smtpPort && Number.isInteger(smtpPort)
              ? smtpPort
              : (() => {
                  throw new Error("SMTP_PORT must be an integer");
                })(),
          user: requiredEnv("SMTP_USER"),
          pass: requiredEnv("SMTP_PASS"),
          from: requiredEnv("SMTP_FROM"),
          bcc: process.env.SMTP_BCC
        }
      : undefined
  };
};

export const requireOpenAiConfig = (
  config: AppConfig
): { apiKey: string; model: string } => {
  if (!config.openAiApiKey) {
    throw new Error("Missing required environment variable: OPENAI_API_KEY");
  }

  return {
    apiKey: config.openAiApiKey,
    model: config.openAiModel
  };
};

export const requireSmtpConfig = (
  config: AppConfig
): NonNullable<AppConfig["smtp"]> => {
  if (!config.smtp) {
    throw new Error("Missing SMTP configuration. Set SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, and SMTP_FROM.");
  }

  return config.smtp;
};
