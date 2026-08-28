import { SHEETS } from "../domain/lead";
import { SheetsClient } from "./sheetsClient";

export type SalesManagementLead = {
  rowNumber: number;
  leadId: string;
  companyName: string;
  leadType: string;
  industry: string;
  region: string;
  officialSiteUrl: string;
  contactMethod: string;
  contactFormUrl: string;
  emailAddress: string;
  salesScore: number;
  salesAngle: string;
  salesMessageDraft: string;
  status: string;
  lastApproachDate: string;
  nextActionDate: string;
  memo: string;
};

export type SalesManagementColumnMap = {
  leadId: number;
  companyName: number;
  leadType: number;
  industry: number;
  region: number;
  officialSiteUrl: number;
  contactMethod: number;
  contactFormUrl: number;
  emailAddress: number;
  salesScore: number;
  salesAngle: number;
  salesMessageDraft: number;
  status: number;
  lastApproachDate: number;
  nextActionDate: number;
  memo: number;
};

export type SalesManagementTable = {
  headers: string[];
  columns: SalesManagementColumnMap;
  leads: SalesManagementLead[];
};

const HEADER_ALIASES: Record<keyof SalesManagementColumnMap, string[]> = {
  leadId: ["リードID"],
  companyName: ["企業名", "会社名"],
  leadType: ["営業先種別"],
  industry: ["業種"],
  region: ["地域"],
  officialSiteUrl: ["公式サイトURL"],
  contactMethod: ["連絡方法"],
  contactFormUrl: ["フォームURL", "問い合わせフォームURL", "連絡先"],
  emailAddress: ["メールアドレス", "メール"],
  salesScore: ["営業スコア"],
  salesAngle: ["営業の切り口"],
  salesMessageDraft: ["営業メッセージ案", "送信メッセージ"],
  status: ["ステータス"],
  lastApproachDate: ["最終アプローチ日"],
  nextActionDate: ["次回対応日"],
  memo: ["メモ"]
};

const RANGE = `'${SHEETS.salesManagement}'!A1:AZ1000`;

const cell = (row: unknown[], index: number): string => {
  const value = row[index];
  return value === undefined || value === null ? "" : String(value).trim();
};

const parseScore = (value: string): number => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

export const columnLetter = (zeroBasedIndex: number): string => {
  let value = zeroBasedIndex + 1;
  let letters = "";

  while (value > 0) {
    const remainder = (value - 1) % 26;
    letters = String.fromCharCode(65 + remainder) + letters;
    value = Math.floor((value - 1) / 26);
  }

  return letters;
};

const findColumnIndex = (headers: string[], names: string[]): number => {
  return headers.findIndex((header) => names.includes(header.trim()));
};

const buildColumnMap = (headers: string[]): SalesManagementColumnMap => {
  const entries = Object.entries(HEADER_ALIASES).map(([key, aliases]) => {
    const index = findColumnIndex(headers, aliases);

    if (index === -1) {
      throw new Error(`Missing required column in ${SHEETS.salesManagement}: ${aliases.join(" / ")}`);
    }

    return [key, index];
  });

  return Object.fromEntries(entries) as SalesManagementColumnMap;
};

const toLead = (
  row: unknown[],
  rowNumber: number,
  columns: SalesManagementColumnMap
): SalesManagementLead => {
  return {
    rowNumber,
    leadId: cell(row, columns.leadId),
    companyName: cell(row, columns.companyName),
    leadType: cell(row, columns.leadType),
    industry: cell(row, columns.industry),
    region: cell(row, columns.region),
    officialSiteUrl: cell(row, columns.officialSiteUrl),
    contactMethod: cell(row, columns.contactMethod),
    contactFormUrl: cell(row, columns.contactFormUrl),
    emailAddress: cell(row, columns.emailAddress),
    salesScore: parseScore(cell(row, columns.salesScore)),
    salesAngle: cell(row, columns.salesAngle),
    salesMessageDraft: cell(row, columns.salesMessageDraft),
    status: cell(row, columns.status),
    lastApproachDate: cell(row, columns.lastApproachDate),
    nextActionDate: cell(row, columns.nextActionDate),
    memo: cell(row, columns.memo)
  };
};

export const readSalesManagementTable = async (
  sheets: SheetsClient
): Promise<SalesManagementTable> => {
  const rows = await sheets.getValues(RANGE);
  const headers = (rows[0] ?? []).map((value) => String(value ?? "").trim());
  const columns = buildColumnMap(headers);
  const leads = rows
    .slice(1)
    .map((row, index) => toLead(row, index + 2, columns))
    .filter((lead) => lead.leadId);

  return {
    headers,
    columns,
    leads
  };
};

export const statusRangeForRow = (
  columns: SalesManagementColumnMap,
  rowNumber: number
): string => {
  const statusColumn = columnLetter(columns.status);
  return `'${SHEETS.salesManagement}'!${statusColumn}${rowNumber}:${statusColumn}${rowNumber}`;
};
