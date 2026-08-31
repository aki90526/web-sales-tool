import { loadConfig } from "../config/env";
import { SalesLeadInput } from "../domain/lead";
import { createSheetsClient } from "../google/sheetsClient";
import { appendSalesLead } from "../google/salesLeadRepository";

const timestamp = (): string => {
  const now = new Date();
  const pad = (value: number): string => value.toString().padStart(2, "0");

  return [
    now.getFullYear(),
    pad(now.getMonth() + 1),
    pad(now.getDate()),
    pad(now.getHours()),
    pad(now.getMinutes()),
    pad(now.getSeconds())
  ].join("");
};

const buildTestLead = (): SalesLeadInput => {
  const id = `L-TEST-${timestamp()}`;

  return {
    leadId: id,
    companyName: "API接続テスト株式会社",
    leadType: "直クライアント",
    industry: "テスト業種",
    region: "埼玉県春日部市",
    officialSiteUrl: "https://example.com/api-test",
    contactMethod: "問い合わせフォーム",
    contactFormUrl: "https://example.com/api-test/contact",
    emailAddress: "",
    salesScore: 50,
    status: "未確認",
    memo: "npm run test:sheets による自動追加テスト"
  };
};

const main = async (): Promise<void> => {
  const config = loadConfig();
  const sheets = await createSheetsClient(config);
  const lead = buildTestLead();
  const result = await appendSalesLead(sheets, lead);

  console.log(`Added test lead: ${result.leadId}`);
  console.log(`Updated range: ${result.range ?? "(unknown)"}`);
  console.log(`Row number: ${result.rowNumber}`);
};

main().catch((error: unknown) => {
  if (error instanceof Error) {
    console.error(error.message);
  } else {
    console.error(error);
  }

  process.exitCode = 1;
});
