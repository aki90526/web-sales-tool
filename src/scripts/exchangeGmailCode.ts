import { loadConfig, requireGmailOAuthClientConfig } from "../config/env";
import { exchangeGmailAuthorizationCode } from "../google/gmailClient";

type CliOptions = {
  code: string;
  help: boolean;
};

const printHelp = (): void => {
  console.log(`Usage:
  npm run gmail:exchange-code -- --code "4/xxxxxxxx"

Options:
  --code    Google OAuth redirect URL に含まれる code 値
`);
};

const nextValue = (args: string[], index: number, name: string): string => {
  const value = args[index + 1];

  if (!value || value.startsWith("--")) {
    throw new Error(`Missing value for ${name}`);
  }

  return value;
};

const parseArgs = (argv: string[]): CliOptions => {
  const options: CliOptions = {
    code: "",
    help: false
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === "--help" || arg === "-h") {
      options.help = true;
    } else if (arg === "--code") {
      options.code = nextValue(argv, index, "--code");
      index += 1;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (!options.help && !options.code) {
    throw new Error("--code is required");
  }

  return options;
};

const main = async (): Promise<void> => {
  const options = parseArgs(process.argv.slice(2));

  if (options.help) {
    printHelp();
    return;
  }

  const config = requireGmailOAuthClientConfig(loadConfig());
  const token = await exchangeGmailAuthorizationCode(config, options.code);

  if (!token.refresh_token) {
    console.log("No refresh_token returned. Re-run gmail:auth-url and approve with prompt=consent, or remove prior app access in Google Account.");
    return;
  }

  console.log("Add this to .env:");
  console.log(`GMAIL_REFRESH_TOKEN=${token.refresh_token}`);
};

main().catch((error: unknown) => {
  if (error instanceof Error) {
    console.error(error.message);
  } else {
    console.error(error);
  }

  process.exitCode = 1;
});
