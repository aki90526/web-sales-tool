import https from "https";
import querystring from "querystring";
import { URL } from "url";

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const GMAIL_BASE_URL = "https://gmail.googleapis.com/gmail/v1/users";

export const GMAIL_READONLY_SCOPE = "https://www.googleapis.com/auth/gmail.readonly";

export type GmailConfig = {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
  userEmail: string;
};

export type GmailOAuthClientConfig = {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
};

type TokenResponse = {
  access_token: string;
  expires_in?: number;
  refresh_token?: string;
  scope?: string;
  token_type: string;
};

type GmailListMessagesResponse = {
  messages?: Array<{
    id: string;
    threadId: string;
  }>;
  resultSizeEstimate?: number;
};

type GmailMessageResponse = {
  id: string;
  threadId: string;
  internalDate?: string;
  payload?: {
    headers?: Array<{
      name: string;
      value: string;
    }>;
  };
};

type JsonRequestOptions = {
  method: "GET" | "POST";
  url: string;
  accessToken?: string;
  body?: unknown;
  contentType?: "application/json" | "application/x-www-form-urlencoded";
};

export type GmailMessageMetadata = {
  id: string;
  threadId: string;
  internalDate?: Date;
  from: string;
  subject: string;
  date: string;
  messageId: string;
  inReplyTo: string;
  references: string;
};

export type GmailClient = {
  searchMessages: (query: string, maxResults: number) => Promise<GmailMessageMetadata[]>;
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

        response.on("data", (chunk: Buffer) => chunks.push(chunk));
        response.on("end", () => {
          const raw = Buffer.concat(chunks).toString("utf8");
          const statusCode = response.statusCode ?? 0;

          if (statusCode < 200 || statusCode >= 300) {
            reject(new Error(`Gmail API request failed (${statusCode}): ${raw}`));
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

export const buildGmailAuthUrl = (config: GmailOAuthClientConfig): string => {
  return `https://accounts.google.com/o/oauth2/v2/auth?${querystring.stringify({
    client_id: config.clientId,
    redirect_uri: config.redirectUri,
    response_type: "code",
    scope: GMAIL_READONLY_SCOPE,
    access_type: "offline",
    prompt: "consent"
  })}`;
};

export const exchangeGmailAuthorizationCode = async (
  config: GmailOAuthClientConfig,
  code: string
): Promise<TokenResponse> => {
  return requestJson<TokenResponse>({
    method: "POST",
    url: TOKEN_URL,
    contentType: "application/x-www-form-urlencoded",
    body: querystring.stringify({
      client_id: config.clientId,
      client_secret: config.clientSecret,
      code,
      grant_type: "authorization_code",
      redirect_uri: config.redirectUri
    })
  });
};

const refreshAccessToken = async (config: GmailConfig): Promise<string> => {
  const response = await requestJson<TokenResponse>({
    method: "POST",
    url: TOKEN_URL,
    contentType: "application/x-www-form-urlencoded",
    body: querystring.stringify({
      client_id: config.clientId,
      client_secret: config.clientSecret,
      refresh_token: config.refreshToken,
      grant_type: "refresh_token"
    })
  });

  return response.access_token;
};

const headerValue = (message: GmailMessageResponse, name: string): string => {
  const header = message.payload?.headers?.find(
    (candidate) => candidate.name.toLowerCase() === name.toLowerCase()
  );

  return header?.value ?? "";
};

const toMetadata = (message: GmailMessageResponse): GmailMessageMetadata => {
  return {
    id: message.id,
    threadId: message.threadId,
    internalDate: message.internalDate ? new Date(Number(message.internalDate)) : undefined,
    from: headerValue(message, "From"),
    subject: headerValue(message, "Subject"),
    date: headerValue(message, "Date"),
    messageId: headerValue(message, "Message-ID"),
    inReplyTo: headerValue(message, "In-Reply-To"),
    references: headerValue(message, "References")
  };
};

export const createGmailClient = async (config: GmailConfig): Promise<GmailClient> => {
  const accessToken = await refreshAccessToken(config);
  const user = encodeURIComponent(config.userEmail || "me");

  return {
    searchMessages: async (query: string, maxResults: number): Promise<GmailMessageMetadata[]> => {
      const list = await requestJson<GmailListMessagesResponse>({
        method: "GET",
        url: `${GMAIL_BASE_URL}/${user}/messages?${querystring.stringify({
          q: query,
          maxResults
        })}`,
        accessToken
      });

      const messages = list.messages ?? [];

      return Promise.all(
        messages.map(async (message) => {
          const detail = await requestJson<GmailMessageResponse>({
            method: "GET",
            url: `${GMAIL_BASE_URL}/${user}/messages/${message.id}?${querystring.stringify({
              format: "metadata",
              metadataHeaders: [
                "From",
                "Subject",
                "Date",
                "Message-ID",
                "In-Reply-To",
                "References"
              ]
            })}`,
            accessToken
          });

          return toMetadata(detail);
        })
      );
    }
  };
};
