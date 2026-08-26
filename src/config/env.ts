import dotenv from "dotenv";

dotenv.config();

export type AppConfig = {
  googleSpreadsheetId: string;
  googleServiceAccountEmail: string;
  googlePrivateKey: string;
  openAiApiKey?: string;
  openAiModel: string;
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
  return {
    googleSpreadsheetId: requiredEnv("GOOGLE_SPREADSHEET_ID"),
    googleServiceAccountEmail: requiredEnv("GOOGLE_SERVICE_ACCOUNT_EMAIL"),
    googlePrivateKey: normalizePrivateKey(requiredEnv("GOOGLE_PRIVATE_KEY")),
    openAiApiKey: process.env.OPENAI_API_KEY,
    openAiModel: process.env.OPENAI_MODEL ?? "gpt-5.6-luna"
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
