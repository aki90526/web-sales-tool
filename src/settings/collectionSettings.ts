import { SHEETS } from "../domain/lead";
import { CollectionGuidance, DEFAULT_COLLECTION_GUIDANCE } from "../openai/leadCandidateCollector";
import { SheetsClient } from "../google/sheetsClient";

// 設定シートの項目名（営業先を探すAIへの指示のうち、利用者ごとに変えられる部分）
export const COLLECTION_SETTING_KEYS = {
  purpose: "収集_目的",
  partnerFocus: "収集_制作会社・広告代理店の重視点",
  directFocus: "収集_直クライアントの重視点"
} as const;

// 設定シートが空欄・未登録の項目は、既定の指示を使う
export const readCollectionGuidance = async (sheets: SheetsClient): Promise<CollectionGuidance> => {
  const rows = await sheets.getValues(`'${SHEETS.settings}'!A2:C200`);
  const values = new Map<string, string>();

  rows.forEach((row) => {
    const key = String(row[0] ?? "").trim();

    if (key) {
      values.set(key, String(row[1] ?? "").trim());
    }
  });

  return {
    purpose: values.get(COLLECTION_SETTING_KEYS.purpose) || DEFAULT_COLLECTION_GUIDANCE.purpose,
    partnerFocus: values.get(COLLECTION_SETTING_KEYS.partnerFocus) || DEFAULT_COLLECTION_GUIDANCE.partnerFocus,
    directFocus: values.get(COLLECTION_SETTING_KEYS.directFocus) || DEFAULT_COLLECTION_GUIDANCE.directFocus
  };
};
