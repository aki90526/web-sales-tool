import dotenv from "dotenv";

dotenv.config();

export type AppConfig = {
  googleSpreadsheetId: string;
  googleServiceAccountEmail: string;
  googlePrivateKey: string;
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
    googlePrivateKey: normalizePrivateKey(requiredEnv("GOOGLE_PRIVATE_KEY"))
  };
};
