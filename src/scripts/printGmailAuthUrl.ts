import { loadConfig, requireGmailOAuthClientConfig } from "../config/env";
import { buildGmailAuthUrl } from "../google/gmailClient";

const main = (): void => {
  const config = requireGmailOAuthClientConfig(loadConfig());

  console.log("Open this URL in your browser, approve Gmail read-only access, then copy the code from the redirected URL.");
  console.log(buildGmailAuthUrl(config));
};

main();
