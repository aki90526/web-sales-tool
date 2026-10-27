import fs from "fs";
import path from "path";
import { FORM_IFRAME_HOSTS, FormSnapshot, pageSnapshotForm } from "../form/formSnapshot";
import { HeadlessChromeClient, startHeadlessChrome } from "../form/headlessChrome";

// 問い合わせフォームのページを画面なしのChromeで開き、自動入力の回帰テスト用に test/form-fixtures へ保存する。
// JavaScriptで後から表示されるフォームも保存でき、CSSで隠れている欄には display:none を付けて実際の見え方を再現する。
//
//   npm run test:forms:save -- https://example.co.jp/contact/
//   npm run test:forms:save -- https://example.co.jp/contact/ --name example-contact
//
// 保存後に npm run test:forms を実行すると、入力結果から *.expected.json が作られる。内容を必ず目で確認すること。

const FIXTURE_DIR = path.resolve(__dirname, "../../test/form-fixtures");

const snapshot = async (client: HeadlessChromeClient): Promise<FormSnapshot> => {
  await new Promise((resolve) => setTimeout(resolve, 3000));
  const response = await client.Runtime.evaluate({
    expression: `(${pageSnapshotForm.toString()})(${JSON.stringify(FORM_IFRAME_HOSTS.source)})`,
    returnByValue: true
  });

  return response.result.value as FormSnapshot;
};

const defaultName = (url: string): string => {
  const parsed = new URL(url);
  return `site-${parsed.hostname.replace(/^www\./, "").replace(/\./g, "-")}`;
};

const main = async (): Promise<void> => {
  const args = process.argv.slice(2);
  const nameIndex = args.indexOf("--name");
  const name = nameIndex >= 0 ? args[nameIndex + 1] : "";
  const urls = args.filter((arg, index) => /^https?:\/\//.test(arg) && (nameIndex < 0 || index !== nameIndex + 1));

  if (urls.length === 0) {
    throw new Error("Usage: npm run test:forms:save -- <フォームURL> [--name 保存名]");
  }

  const chrome = await startHeadlessChrome(9334);

  try {
    for (const url of urls) {
      try {
        let result = await chrome.withPage(url, snapshot);

        if ("iframe" in result) {
          result = await chrome.withPage(result.iframe, snapshot);
        }

        if (!("html" in result)) {
          console.log(`SKIP  ${url}: フォームが見つかりませんでした`);
          continue;
        }

        const fixtureName = (urls.length === 1 && name) || defaultName(url);
        const file = path.join(FIXTURE_DIR, `${fixtureName}.html`);
        fs.writeFileSync(
          file,
          `<!doctype html>\n<!-- source: ${url} -->\n<html lang="ja"><head><meta charset="utf-8"><title>${fixtureName}</title></head><body>\n${result.html}\n</body></html>\n`
        );
        console.log(`SAVE  ${url} -> ${path.relative(process.cwd(), file)}`);
      } catch (error) {
        console.log(`SKIP  ${url}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  } finally {
    await chrome.close();
  }
};

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
