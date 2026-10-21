import fs from "fs";
import path from "path";
import { HeadlessChromeClient, startHeadlessChrome } from "../form/headlessChrome";

// 問い合わせフォームのページを画面なしのChromeで開き、自動入力の回帰テスト用に test/form-fixtures へ保存する。
// JavaScriptで後から表示されるフォームも保存でき、CSSで隠れている欄には display:none を付けて実際の見え方を再現する。
//
//   npm run test:forms:save -- https://example.co.jp/contact/
//   npm run test:forms:save -- https://example.co.jp/contact/ --name example-contact
//
// 保存後に npm run test:forms を実行すると、入力結果から *.expected.json が作られる。内容を必ず目で確認すること。

const FIXTURE_DIR = path.resolve(__dirname, "../../test/form-fixtures");
const FORM_IFRAME_HOSTS = /(bownow|hsforms|hubspot|formrun|form\.run|typeform|tayori|formmailer|f\.msgs|kintoneapp|google\.com\/forms|docs\.google\.com\/forms)/i;

type Snapshot = { html: string } | { iframe: string } | { none: true };

const pageSnapshotForm = (iframeHostPattern: string): Snapshot => {
  const hidden = (element: Element): boolean => {
    const style = window.getComputedStyle(element);
    return style.display === "none" || style.visibility === "hidden";
  };
  const visibleControls = (root: Element): number =>
    Array.from(root.querySelectorAll("input, textarea, select")).filter((element) => {
      const type = (element.getAttribute("type") || "").toLowerCase();
      const rect = element.getBoundingClientRect();
      return !["hidden", "submit", "button", "image", "reset"].includes(type) && rect.width > 0 && rect.height > 0;
    }).length;

  const forms = Array.from(document.querySelectorAll("form"))
    .map((form) => ({ form, count: visibleControls(form) }))
    .filter(({ form, count }) => count >= 3 || (count >= 1 && form.querySelector("textarea")))
    .sort((a, b) => b.count - a.count);

  if (forms.length === 0) {
    const iframe = Array.from(document.querySelectorAll("iframe")).find((frame) => new RegExp(iframeHostPattern, "i").test(frame.src));
    return iframe ? { iframe: iframe.src } : { none: true };
  }

  const root = forms[0].form;
  root.querySelectorAll("*").forEach((element) => {
    if (!(element instanceof HTMLElement)) {
      return;
    }

    const style = window.getComputedStyle(element);
    if (style.display === "none") {
      element.setAttribute("style", "display:none");
    } else if (style.visibility === "hidden") {
      element.setAttribute("style", "visibility:hidden");
    }
  });

  if (hidden(root)) {
    root.removeAttribute("style");
  }

  const clone = root.cloneNode(true) as HTMLElement;
  clone.querySelectorAll("script, noscript, style, link, iframe").forEach((element) => element.remove());

  return { html: clone.outerHTML };
};

const snapshot = async (client: HeadlessChromeClient): Promise<Snapshot> => {
  await new Promise((resolve) => setTimeout(resolve, 3000));
  const response = await client.Runtime.evaluate({
    expression: `(${pageSnapshotForm.toString()})(${JSON.stringify(FORM_IFRAME_HOSTS.source)})`,
    returnByValue: true
  });

  return response.result.value as Snapshot;
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
