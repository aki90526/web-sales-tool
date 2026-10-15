import fs from "fs";
import path from "path";
import { pageAutofill, pageSelectBestTab, scoreChoiceTextForTabs } from "../form/browserFormAutofill";

// ブックマークレットから読み込む「自動入力スクリプト」を public/bookmarklet/autofill.js に書き出す。
// 自動入力の判定ロジック（pageAutofill）は、Chrome遠隔操作と同じものを使う。
const script = `(function () {
  var autofill = ${pageAutofill.toString()};
  var selectBestTab = ${pageSelectBestTab.toString()};
  var scoreForTabs = ${scoreChoiceTextForTabs.toString()};

  var showToast = function (message, isError) {
    var old = document.getElementById("__wst_toast");
    if (old) old.remove();
    var box = document.createElement("div");
    box.id = "__wst_toast";
    box.style.cssText = "position:fixed;top:12px;right:12px;z-index:2147483647;max-width:340px;padding:12px 14px;border-radius:10px;font:13px/1.5 sans-serif;color:#fff;box-shadow:0 4px 14px rgba(0,0,0,.3);white-space:pre-wrap;background:" + (isError ? "#b91c1c" : "#166534");
    box.textContent = message;
    box.onclick = function () { box.remove(); };
    document.body.appendChild(box);
    setTimeout(function () { if (box.parentNode) box.remove(); }, 12000);
  };

  var readPayload = async function () {
    var text = "";
    try {
      text = await navigator.clipboard.readText();
    } catch (error) {
      text = "";
    }
    if (!text || text.indexOf('"wstVersion"') === -1) {
      text = window.prompt("ダッシュボードの「ブックマークレット用にコピー」でコピーした内容を貼り付けてください") || "";
    }
    return JSON.parse(text);
  };

  readPayload()
    .then(function (payload) {
      if (!payload || payload.wstVersion !== 1 || !payload.sender || !payload.candidate) {
        throw new Error("入力データが正しくありません。ダッシュボードで「ブックマークレット用にコピー」を押してから、もう一度お試しください。");
      }
      // お問い合わせ種別ごとにタブでフォームが切り替わるページでは、協業・提案向けのタブを先に選ぶ
      var tab = selectBestTab(scoreForTabs);
      return new Promise(function (resolve) { setTimeout(resolve, tab && tab.clicked ? 800 : 0); }).then(function () { return payload; });
    })
    .then(function (payload) {
      var result = autofill(payload);
      var lines = ["自動入力しました（" + payload.candidate.companyName + "）", "入力: " + result.filled.length + "項目 / 選択: " + result.selected.length + "項目 / 同意: " + result.checked.length + "項目"];
      if (result.captcha) lines.push("⚠ " + result.captcha + " があります。手動で操作してください。");
      result.warnings.slice(0, 5).forEach(function (warning) { lines.push("⚠ " + warning); });
      lines.push("内容を確認して、送信は自分で行ってください。");
      showToast(lines.join("\\n"), false);
    })
    .catch(function (error) {
      showToast("自動入力できませんでした: " + (error && error.message ? error.message : error), true);
    });
})();
`;

const outDir = path.resolve(process.cwd(), "public", "bookmarklet");
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, "autofill.js"), script, "utf8");
console.log(`Wrote ${path.join(outDir, "autofill.js")} (${Math.round(script.length / 1024)} KB)`);
