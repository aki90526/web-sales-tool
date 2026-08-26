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
    source: "API接続確認",
    contactUrl: "https://example.com/api-test/contact",
    email: "test@example.com",
    siteAnalysisSummary: "Google Sheets APIからの書き込み確認用データです。",
    improvementPoints: "実運用前に接続・行追加・数式反映を確認します。",
    salesScore: 50,
    proposalType: "Webサイト改善提案",
    salesMessageDraft: "API接続確認用の営業メッセージ案です。",
    reviewStatus: "未確認",
    sendPermission: "未判定",
    sendStatus: "未送信",
    replyStatus: "未返信",
    excludeFlag: false,
    excludeReason: "",
    updatedAt: new Date().toISOString().slice(0, 10),
    memo: "npm run test:sheets による自動追加テスト",
    capital: "不明",
    employeeCount: "不明",
    annualRevenue: "不明",
    listingStatus: "不明",
    companySizeCategory: "不明",
    companySizeMemo: "API接続確認用の規模情報です。"
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
