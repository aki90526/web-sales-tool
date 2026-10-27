import crypto from "crypto";
import fs from "fs";
import path from "path";
import type { FormSnapshot } from "./formSnapshot";

// 自動入力を実行したときのフォームの構造と、自動入力の判定結果の記録（回帰テストの候補）。
// 阿部さんが画面（/forms）で「正しい／間違いがある」を確認すると、正しいものはテスト用データ（test/form-fixtures）に加わる。
// 他社のページの一部を含むため、この記録は端末の中だけに置く（git管理しない）。

export type FormSampleField = { field: string; valueName: string; label: string };

export type FormSample = {
  id: string;
  leadId: string;
  companyName: string;
  formUrl: string;
  finalUrl: string;
  capturedAt: string;
  snapshot: FormSnapshot;
  filled: FormSampleField[];
  selected: Array<{ label: string; option: string }>;
  warnings: string[];
  confirmStatus: string;
  confirmDetail: string;
  captcha: string;
  status: "pending" | "ok" | "ng";
  note: string;
  reviewedAt: string;
  fixtureName: string;
};

export const SAMPLE_DIR = path.resolve(process.cwd(), "data/form-samples");
const MAX_HTML_BYTES = 400_000;

export const sampleIdFor = (formUrl: string): string => {
  try {
    const url = new URL(formUrl);
    const key = `${url.hostname.replace(/^www\./, "")}${url.pathname.replace(/\/+$/, "")}`;
    return crypto.createHash("sha1").update(key).digest("hex").slice(0, 10);
  } catch {
    return crypto.createHash("sha1").update(formUrl).digest("hex").slice(0, 10);
  }
};

const fileFor = (id: string): string => path.join(SAMPLE_DIR, `${id}.json`);

export const readFormSample = (id: string): FormSample | null => {
  try {
    return JSON.parse(fs.readFileSync(fileFor(id), "utf8")) as FormSample;
  } catch {
    return null;
  }
};

export const listFormSamples = (): FormSample[] => {
  try {
    return fs
      .readdirSync(SAMPLE_DIR)
      .filter((name) => name.endsWith(".json"))
      .map((name) => readFormSample(name.replace(/\.json$/, "")))
      .filter((sample): sample is FormSample => sample !== null)
      .sort((a, b) => b.capturedAt.localeCompare(a.capturedAt));
  } catch {
    return [];
  }
};

export const writeFormSample = (sample: FormSample): void => {
  fs.mkdirSync(SAMPLE_DIR, { recursive: true });
  fs.writeFileSync(fileFor(sample.id), JSON.stringify(sample, null, 2));
};

// 実行のたびに記録する。同じフォーム（ドメイン+パス）は1件にまとめ、確認済み（正しい／間違い）のものは上書きしない
export const recordFormSample = (input: Omit<FormSample, "id" | "status" | "note" | "reviewedAt" | "fixtureName">): void => {
  const id = sampleIdFor(input.formUrl);
  const existing = readFormSample(id);

  if (existing && existing.status !== "pending") {
    return;
  }

  const snapshot: FormSnapshot =
    "html" in input.snapshot && Buffer.byteLength(input.snapshot.html) > MAX_HTML_BYTES ? { none: true } : input.snapshot;

  writeFormSample({ ...input, snapshot, id, status: "pending", note: "", reviewedAt: "", fixtureName: "" });
};
