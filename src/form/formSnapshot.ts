// フォーム部分だけを取り出す（自動入力の回帰テスト用の保存と、実行時のサンプル収集で共通に使う）。
// CSSで隠れている欄には display:none を付けて、実際の見え方を再現する。ページの中で実行する関数なので、外の変数を使わないこと。

export const FORM_IFRAME_HOSTS = /(bownow|hsforms|hubspot|formrun|form\.run|typeform|tayori|formmailer|f\.msgs|kintoneapp|google\.com\/forms|docs\.google\.com\/forms)/i;

export type FormSnapshot = { html: string } | { iframe: string } | { none: true };

export const pageSnapshotForm = (iframeHostPattern: string): FormSnapshot => {
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

