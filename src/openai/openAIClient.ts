import https from "https";
import { URL } from "url";

type OpenAIClientOptions = {
  apiKey: string;
  model: string;
};

type JsonRequestOptions = {
  method: "POST";
  url: string;
  apiKey: string;
  body: unknown;
  timeoutMs?: number;
  maxAttempts?: number;
};

type ResponseContent = {
  type?: string;
  text?: string;
};

type ResponseOutputItem = {
  type?: string;
  content?: ResponseContent[];
};

export type OpenAIResponse = {
  id?: string;
  output_text?: string;
  output?: ResponseOutputItem[];
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    total_tokens?: number;
  };
};

export type OpenAIClient = {
  createWebSearchResponse: (input: string, maxOutputTokens?: number) => Promise<OpenAIResponse>;
};

type RequestError = Error & {
  code?: string;
  statusCode?: number;
  responseBody?: string;
};

const sleep = async (ms: number): Promise<void> => {
  await new Promise((resolve) => setTimeout(resolve, ms));
};

const shouldRetry = (error: RequestError): boolean => {
  if (error.responseBody?.includes("insufficient_quota")) {
    return false;
  }

  if (error.statusCode !== undefined) {
    return [408, 409, 429, 500, 502, 503, 504].includes(error.statusCode);
  }

  return ["ECONNRESET", "ETIMEDOUT", "EAI_AGAIN", "ENOTFOUND"].includes(error.code ?? "");
};

const requestJsonOnce = async <T>(options: JsonRequestOptions): Promise<T> => {
  const parsedUrl = new URL(options.url);
  const body = JSON.stringify(options.body);

  return new Promise<T>((resolve, reject) => {
    const request = https.request(
      {
        method: options.method,
        hostname: parsedUrl.hostname,
        path: `${parsedUrl.pathname}${parsedUrl.search}`,
        headers: {
          Authorization: `Bearer ${options.apiKey}`,
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(body)
        }
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
            const error = new Error(`OpenAI API request failed (${statusCode}): ${raw}`) as RequestError;
            error.statusCode = statusCode;
            error.responseBody = raw;
            reject(error);
            return;
          }

          resolve(raw ? (JSON.parse(raw) as T) : ({} as T));
        });
      }
    );

    request.on("error", reject);
    request.setTimeout(options.timeoutMs ?? 120000, () => {
      request.destroy(new Error("OpenAI API request timed out"));
    });

    request.write(body);
    request.end();
  });
};

const requestJson = async <T>(options: JsonRequestOptions): Promise<T> => {
  const maxAttempts = options.maxAttempts ?? 3;
  let lastError: RequestError | undefined;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await requestJsonOnce<T>(options);
    } catch (error: unknown) {
      lastError = error instanceof Error ? (error as RequestError) : new Error(String(error));

      if (attempt >= maxAttempts || !shouldRetry(lastError)) {
        throw lastError;
      }

      const waitMs = attempt * 2000;
      console.warn(`OpenAI request failed (${lastError.code ?? lastError.statusCode ?? "unknown"}). Retrying in ${waitMs / 1000}s...`);
      await sleep(waitMs);
    }
  }

  throw lastError ?? new Error("OpenAI API request failed");
};

export const createOpenAIClient = (options: OpenAIClientOptions): OpenAIClient => {
  return {
    createWebSearchResponse: async (
      input: string,
      maxOutputTokens = 4000
    ): Promise<OpenAIResponse> => {
      return requestJson<OpenAIResponse>({
        method: "POST",
        url: "https://api.openai.com/v1/responses",
        apiKey: options.apiKey,
        body: {
          model: options.model,
          tools: [
            {
              type: "web_search",
              search_context_size: "low"
            }
          ],
          input,
          max_output_tokens: maxOutputTokens,
          store: false
        }
      });
    }
  };
};

export const extractOutputText = (response: OpenAIResponse): string => {
  if (typeof response.output_text === "string" && response.output_text.trim()) {
    return response.output_text;
  }

  const text = response.output
    ?.flatMap((item) => item.content ?? [])
    .filter((content) => content.type === "output_text" && typeof content.text === "string")
    .map((content) => content.text)
    .join("\n");

  if (!text?.trim()) {
    throw new Error("OpenAI response did not include output text");
  }

  return text;
};
