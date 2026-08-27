import { loadConfig, requireSmtpConfig } from "../config/env";
import { createSmtpMailer } from "../email/smtpMailer";

const DEFAULT_TO = "aki90526@gmail.com";

type CliOptions = {
  to: string;
  help: boolean;
};

const printHelp = (): void => {
  console.log(`Usage:
  npm run send:test-email
  npm run send:test-email -- --to "aki90526@gmail.com"

Options:
  --to     テスト送信先。省略時は ${DEFAULT_TO}
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
    to: DEFAULT_TO,
    help: false
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === "--help" || arg === "-h") {
      options.help = true;
    } else if (arg === "--to") {
      options.to = nextValue(argv, index, "--to");
      index += 1;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(options.to)) {
    throw new Error("--to must be a valid email address");
  }

  return options;
};

const main = async (): Promise<void> => {
  const options = parseArgs(process.argv.slice(2));

  if (options.help) {
    printHelp();
    return;
  }

  const config = loadConfig();
  const smtpConfig = requireSmtpConfig(config);
  const mailer = createSmtpMailer(smtpConfig);
  const sentAt = new Intl.DateTimeFormat("ja-JP", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  }).format(new Date());

  console.log(`Verifying SMTP connection for ${smtpConfig.user}...`);
  await mailer.verify();

  console.log(`Sending test email to ${options.to}...`);
  const result = await mailer.send({
    to: options.to,
    subject: "【テスト】aaWebCreate 営業メール送信確認",
    text: [
      "阿部様",
      "",
      "これは web-sales-tool からの営業メール送信テストです。",
      "SMTP設定と送信元メールアドレスの確認のために送信しています。",
      "",
      `送信日時: ${sentAt}`,
      "",
      "aaWebCreate",
      "阿部 祥士 / Abe Akihito",
      "Email: abe@aawebcreate.com",
      "URL: https://aawebcreate.com/"
    ].join("\n")
  });

  console.log(`Sent test email. Message ID: ${result.messageId}`);
};

main().catch((error: unknown) => {
  if (error instanceof Error) {
    console.error(error.message);
  } else {
    console.error(error);
  }

  process.exitCode = 1;
});
