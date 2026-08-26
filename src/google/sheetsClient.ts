import crypto from "crypto";
import https from "https";
import querystring from "querystring";
import { URL } from "url";
import { AppConfig } from "../config/env";

const SCOPES = ["https://www.googleapis.com/auth/spreadsheets"];
const TOKEN_URL = "https://oauth2.googleapis.com/token";

type TokenResponse = {
  access_token: string;
  expires_in: number;
  token_type: string;
};

type ValuesResponse = {
  values?: unknown[][];
};

export type AppendValuesResponse = {
  updates?: {
    updatedRange?: string;
  };
};

export type UpdateValuesResponse = {
  updatedRange?: string;
};

export type SheetsClient = {
  getValues: (range: string) => Promise<unknown[][]>;
  appendValues: (range: string, values: unknown[][]) => Promise<AppendValuesResponse>;
  updateValues: (range: string, values: unknown[][]) => Promise<UpdateValuesResponse>;
};

type JsonRequestOptions = {
  method: "GET" | "POST" | "PUT";
  url: string;
  accessToken?: string;
  body?: unknown;
  contentType?: "application/json" | "application/x-www-form-urlencoded";
};

const base64Url = (value: string): string => {
  return Buffer.from(value)
    .toString("base64")
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
};

const createJwtAssertion = (config: AppConfig): string => {
  const now = Math.floor(Date.now() / 1000);
  const header = {
    alg: "RS256",
    typ: "JWT"
  };
  const claim = {
    iss: config.googleServiceAccountEmail,
    scope: SCOPES.join(" "),
    aud: TOKEN_URL,
    exp: now + 3600,
    iat: now
  };

  const unsignedToken = `${base64Url(JSON.stringify(header))}.${base64Url(JSON.stringify(claim))}`;
  const signature = crypto.createSign("RSA-SHA256").update(unsignedToken).sign(config.googlePrivateKey);
  const encodedSignature = signature
    .toString("base64")
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");

  return `${unsignedToken}.${encodedSignature}`;
};

const requestJson = async <T>(options: JsonRequestOptions): Promise<T> => {
  const parsedUrl = new URL(options.url);
  const body =
    options.body === undefined
      ? undefined
      : options.contentType === "application/x-www-form-urlencoded"
      ? String(options.body)
      : JSON.stringify(options.body);

  const headers: Record<string, string | number> = {};

  if (options.accessToken) {
    headers.Authorization = `Bearer ${options.accessToken}`;
  }

  if (body !== undefined) {
    headers["Content-Type"] = options.contentType ?? "application/json";
    headers["Content-Length"] = Buffer.byteLength(body);
  }

  return new Promise<T>((resolve, reject) => {
    const request = https.request(
      {
        method: options.method,
        hostname: parsedUrl.hostname,
        path: `${parsedUrl.pathname}${parsedUrl.search}`,
        headers
      },
      (response) => {
        const chunks: Buffer[] = [];

        response.on("data", (chunk: Buffer) => {
          chunks.push(chunk);
        });

        response.on("end", () => {
          const raw = Buffer.concat(chunks).toString("utf8");
          const statusCode = response.statusCode ?? 0;

          if (statusCode < 200 || statusCode >= 300) {
            reject(new Error(`Google API request failed (${statusCode}): ${raw}`));
            return;
          }

          resolve(raw ? (JSON.parse(raw) as T) : ({} as T));
        });
      }
    );

    request.on("error", reject);

    if (body !== undefined) {
      request.write(body);
    }

    request.end();
  });
};

const fetchAccessToken = async (config: AppConfig): Promise<string> => {
  const assertion = createJwtAssertion(config);
  const response = await requestJson<TokenResponse>({
    method: "POST",
    url: TOKEN_URL,
    contentType: "application/x-www-form-urlencoded",
    body: querystring.stringify({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion
    })
  });

  return response.access_token;
};

export const createSheetsClient = async (config: AppConfig): Promise<SheetsClient> => {
  const accessToken = await fetchAccessToken(config);
  const baseUrl = `https://sheets.googleapis.com/v4/spreadsheets/${config.googleSpreadsheetId}/values`;

  return {
    getValues: async (range: string): Promise<unknown[][]> => {
      const response = await requestJson<ValuesResponse>({
        method: "GET",
        url: `${baseUrl}/${encodeURIComponent(range)}`,
        accessToken
      });

      return response.values ?? [];
    },
    appendValues: async (range: string, values: unknown[][]): Promise<AppendValuesResponse> => {
      return requestJson<AppendValuesResponse>({
        method: "POST",
        url: `${baseUrl}/${encodeURIComponent(range)}:append?${querystring.stringify({
          valueInputOption: "USER_ENTERED",
          insertDataOption: "INSERT_ROWS"
        })}`,
        accessToken,
        body: {
          values
        }
      });
    },
    updateValues: async (range: string, values: unknown[][]): Promise<UpdateValuesResponse> => {
      return requestJson<UpdateValuesResponse>({
        method: "PUT",
        url: `${baseUrl}/${encodeURIComponent(range)}?${querystring.stringify({
          valueInputOption: "USER_ENTERED"
        })}`,
        accessToken,
        body: {
          values
        }
      });
    }
  };
};
