import dotenv from "dotenv";

dotenv.config();

export type AppConfig = {
  googleSpreadsheetId: string;
  googleServiceAccountEmail: string;
  googlePrivateKey: string;
  openAiApiKey?: string;
  openAiModel: string;
  gmail?: {
    clientId?: string;
    clientSecret?: string;
    refreshToken?: string;
    redirectUri: string;
    userEmail?: string;
    lookbackDays: number;
  };
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
  const gmailLookbackDays = process.env.GMAIL_LOOKBACK_DAYS ? Number(process.env.GMAIL_LOOKBACK_DAYS) : 30;
  const hasSmtpConfig = Boolean(
    process.env.SMTP_HOST ||
      process.env.SMTP_PORT ||
      process.env.SMTP_USER ||
      process.env.SMTP_PASS ||
      process.env.SMTP_FROM ||
      process.env.SMTP_BCC
  );
  const hasGmailConfig = Boolean(
    process.env.GMAIL_CLIENT_ID ||
      process.env.GMAIL_CLIENT_SECRET ||
      process.env.GMAIL_REFRESH_TOKEN ||
      process.env.GMAIL_USER_EMAIL ||
      process.env.GMAIL_REDIRECT_URI ||
      process.env.GMAIL_LOOKBACK_DAYS
  );

  return {
    googleSpreadsheetId: requiredEnv("GOOGLE_SPREADSHEET_ID"),
    googleServiceAccountEmail: requiredEnv("GOOGLE_SERVICE_ACCOUNT_EMAIL"),
    googlePrivateKey: normalizePrivateKey(requiredEnv("GOOGLE_PRIVATE_KEY")),
    openAiApiKey: process.env.OPENAI_API_KEY,
    openAiModel: process.env.OPENAI_MODEL ?? "gpt-5.6-luna",
    gmail: hasGmailConfig
      ? {
          clientId: process.env.GMAIL_CLIENT_ID,
          clientSecret: process.env.GMAIL_CLIENT_SECRET,
          refreshToken: process.env.GMAIL_REFRESH_TOKEN,
          redirectUri: process.env.GMAIL_REDIRECT_URI ?? "http://localhost:3000/oauth2callback",
          userEmail: process.env.GMAIL_USER_EMAIL,
          lookbackDays:
            Number.isInteger(gmailLookbackDays) && gmailLookbackDays > 0
              ? gmailLookbackDays
              : (() => {
                  throw new Error("GMAIL_LOOKBACK_DAYS must be a positive integer");
                })()
        }
      : undefined,
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

export const requireGmailOAuthClientConfig = (
  config: AppConfig
): { clientId: string; clientSecret: string; redirectUri: string } => {
  if (!config.gmail?.clientId || !config.gmail.clientSecret) {
    throw new Error("Missing Gmail OAuth client configuration. Set GMAIL_CLIENT_ID and GMAIL_CLIENT_SECRET.");
  }

  return {
    clientId: config.gmail.clientId,
    clientSecret: config.gmail.clientSecret,
    redirectUri: config.gmail.redirectUri
  };
};

export const requireGmailConfig = (
  config: AppConfig
): {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
  redirectUri: string;
  userEmail: string;
  lookbackDays: number;
} => {
  const oauth = requireGmailOAuthClientConfig(config);

  if (!config.gmail?.refreshToken) {
    throw new Error("Missing required environment variable: GMAIL_REFRESH_TOKEN");
  }

  return {
    ...oauth,
    refreshToken: config.gmail.refreshToken,
    userEmail: config.gmail.userEmail ?? config.smtp?.user ?? "me",
    lookbackDays: config.gmail.lookbackDays
  };
};
