import fs from "fs";
import path from "path";
import { FormAutofillPayload, pageAutofill } from "../form/browserFormAutofill";
import { HeadlessChrome, startHeadlessChrome } from "../form/headlessChrome";

// 保存した問い合わせフォーム（test/form-fixtures/*.html）に画面なしのChromeで自動入力を実行し、
// 同名の *.expected.json と入力結果を比べる。修正で他のフォームの入力が崩れていないかを確認するための回帰テスト。
// フォームの追加は npm run test:forms:save -- <フォームURL>
//
//   npm run test:forms
//   npm run test:forms -- weed-s      # ファイル名に weed-s を含むものだけ
//   npm run test:forms -- --update    # 現在の入力結果で expected を作り直す（内容を必ず目で確認すること）
//   npm run test:forms -- --verbose   # 各欄をどの項目と判定したかも表示する

const FIXTURE_DIR = path.resolve(__dirname, "../../test/form-fixtures");

// 実データを使わない、テスト専用の送信者情報
export const TEST_PAYLOAD: FormAutofillPayload = {
  sender: {
    companyName: "テスト商店",
    companyNameKana: "テストショウテン",
    name: "山田 太郎",
    nameKana: "ヤマダ タロウ",
    nameHiragana: "やまだ たろう",
    department: "代表",
    businessDescription: "Web制作",
    nameRoman: "Taro Yamada",
    age: "40",
    tel: "09012345678",
    chatworkId: "test-chatwork",
    email: "test@example.com",
    url: "https://example.com/",
    portfolioUrl: "https://example.com/works/",
    address: "埼玉県春日部市中央1-2-3",
    formAddress: "埼玉県春日部市中央1-2-3",
    postalCode: "344-0067",
    prefecture: "埼玉県",
    city: "春日部市",
    streetAddress: "中央1-2-3",
    signatureTagline: "",
    optOutNotice: ""
  },
  formFieldAliases: {
    companyName: [],
    name: [],
    nameKana: [],
    nameHiragana: [],
    age: [],
    department: [],
    email: [],
    tel: [],
    url: [],
    portfolioUrl: [],
    address: [],
    postalCode: [],
    prefecture: [],
    city: [],
    streetAddress: [],
    subject: [],
    body: []
  },
  candidate: {
    leadId: "L-TEST",
    companyName: "テスト株式会社",
    subject: "テスト件名",
    body: "テスト本文"
  }
};

// 見えている入力欄は値、チェックボックス・ラジオは選ばれた value の一覧（name ごと）で表す。
// 非表示の欄（PC用・スマホ用の重複や確認画面用など）は実際の入力に関係しないので含めない
type FieldValues = Record<string, string | string[]>;

const pageReadFieldValues = (): FieldValues => {
  const values: Record<string, string | string[]> = {};
  const isHidden = (element: Element): boolean => {
    for (let node: Element | null = element; node; node = node.parentElement) {
      const style = window.getComputedStyle(node);
      if (style.display === "none" || style.visibility === "hidden") {
        return true;
      }
    }
    return false;
  };

  // name が無い欄（Googleフォームなど）は、id・参照している項目名・出現順で区別する
  const keyFor = (element: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement, index: number): string => {
    const labelledBy = (element.getAttribute("aria-labelledby") ?? "")
      .split(/\s+/)
      .map((id) => document.getElementById(id)?.textContent?.trim() ?? "")
      .filter(Boolean)
      .join(" ");

    return element.name || element.id || (labelledBy && `[${labelledBy.slice(0, 40)}]`) || `${element.tagName.toLowerCase()}#${index}`;
  };

  document.querySelectorAll<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>("input, textarea, select").forEach((element, index) => {
    const type = (element.getAttribute("type") || "").toLowerCase();
    const key = keyFor(element, index);

    if (["hidden", "submit", "button", "reset", "image", "file"].includes(type)) {
      return;
    }

    if (type === "checkbox" || type === "radio") {
      const checked = (values[key] as string[] | undefined) ?? [];
      if ((element as HTMLInputElement).checked) {
        checked.push(element.value);
      }
      values[key] = checked;
      return;
    }

    if (isHidden(element)) {
      return;
    }

    values[key] = element.value;
  });

  return values;
};

type FillDetail = { field: string; valueName: string; label: string };
type SelectDetail = { label: string; option: string };

const fillFixture = async (
  chrome: HeadlessChrome,
  file: string
): Promise<{ values: FieldValues; warnings: string[]; filled: FillDetail[]; selected: SelectDetail[] }> => {
  return chrome.withPage(`file://${file}`, async (client) => {
    const fill = await client.Runtime.evaluate({
      expression: `(${pageAutofill.toString()})(${JSON.stringify(TEST_PAYLOAD)})`,
      awaitPromise: true,
      returnByValue: true
    });

    if (fill.exceptionDetails) {
      throw new Error(fill.exceptionDetails.exception?.description ?? fill.exceptionDetails.text);
    }

    const read = await client.Runtime.evaluate({
      expression: `(${pageReadFieldValues.toString()})()`,
      returnByValue: true
    });

    return {
      values: read.result.value as FieldValues,
      warnings: fill.result.value?.warnings ?? [],
      filled: fill.result.value?.filled ?? [],
      selected: fill.result.value?.selected ?? []
    };
  });
};

const format = (value: string | string[] | undefined): string => {
  return value === undefined ? "(欄なし)" : JSON.stringify(value);
};

const main = async (): Promise<void> => {
  const args = process.argv.slice(2);
  const update = args.includes("--update");
  const verbose = args.includes("--verbose");
  const filter = args.find((arg) => !arg.startsWith("--")) ?? "";
  const fixtures = fs
    .readdirSync(FIXTURE_DIR)
    .filter((name) => name.endsWith(".html") && name.includes(filter))
    .sort();

  if (fixtures.length === 0) {
    throw new Error(`No fixtures in ${FIXTURE_DIR}`);
  }

  const chrome = await startHeadlessChrome();
  let failed = 0;

  try {
    for (const name of fixtures) {
      const file = path.join(FIXTURE_DIR, name);
      const expectedFile = file.replace(/\.html$/, ".expected.json");
      const { values, warnings, filled, selected } = await fillFixture(chrome, file);

      if (verbose) {
        console.log(`----- ${name}`);
        filled.forEach((entry) => console.log(`  ${entry.valueName} <- ${entry.field} | ${entry.label.slice(0, 80)}`));
        selected.forEach((entry) => console.log(`  selected: ${entry.option} | ${entry.label.slice(0, 80)}`));
        warnings.forEach((warning) => console.log(`  warning: ${warning}`));
      }

      if (update || !fs.existsSync(expectedFile)) {
        fs.writeFileSync(expectedFile, `${JSON.stringify(values, null, 2)}\n`);
        console.log(`WRITE ${name}`);
        Object.entries(values).forEach(([field, value]) => console.log(`  ${field}: ${format(value)}`));
        continue;
      }

      const expected = JSON.parse(fs.readFileSync(expectedFile, "utf8")) as FieldValues;
      const diffs = Object.keys({ ...expected, ...values }).filter(
        (field) => JSON.stringify(expected[field]) !== JSON.stringify(values[field])
      );

      // 同名の *.expected-warnings.json（警告に含まれる文言の一覧）があるときは、それぞれの文言を含む警告が出ていることも確認する
      const warningsFile = file.replace(/\.html$/, ".expected-warnings.json");
      const missingWarnings = fs.existsSync(warningsFile)
        ? (JSON.parse(fs.readFileSync(warningsFile, "utf8")) as string[]).filter(
            (needle) => !warnings.some((warning) => warning.includes(needle))
          )
        : [];

      if (diffs.length === 0 && missingWarnings.length === 0) {
        console.log(`PASS  ${name}`);
        continue;
      }

      failed += 1;
      console.log(`FAIL  ${name}`);
      diffs.forEach((field) => {
        console.log(`  ${field}: 期待 ${format(expected[field])} / 実際 ${format(values[field])}`);
      });
      missingWarnings.forEach((needle) => {
        console.log(`  警告なし: 「${needle}」を含む警告が出ていない`);
      });
    }
  } finally {
    await chrome.close();
  }

  console.log(failed === 0 ? `\nOK: ${fixtures.length}件` : `\nNG: ${failed}/${fixtures.length}件`);
  process.exitCode = failed === 0 ? 0 : 1;
};

if (require.main === module) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
