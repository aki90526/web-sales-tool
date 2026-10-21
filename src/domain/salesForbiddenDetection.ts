// 問い合わせページの本文から「営業・勧誘目的の連絡お断り」の記載を検出する。
// 収集時に見逃した場合や、登録後にサイトへ追記された場合に備えて、フォーム自動入力の直前に使う。

const PATTERNS: RegExp[] = [
  /営業(目的|活動|メール|電話|連絡|のお問い?合わせ|のご連絡|のご案内|の連絡|のメール|の電話|行為).{0,14}(禁止|お断り|ご遠慮|遠慮|不可|ご容赦|返信.{0,6}(いたしかね|致しかね|できません))/,
  /(セールス|売り込み|勧誘|販売)(目的|活動|行為)?.{0,14}(禁止|お断り|ご遠慮|遠慮|不可|ご容赦)/,
  /(広告|宣伝)(目的)?(の)?(メール|連絡|電話|お問い?合わせ|行為).{0,14}(禁止|お断り|ご遠慮|遠慮|不可|ご容赦)/,
  /お問い合わせフォーム.{0,20}営業.{0,12}(禁止|お断り|不可)/
];

// 該当すれば根拠となった文言（前後を含む短い抜粋）を返し、なければ null
export const detectSalesForbidden = (pageText: string): string | null => {
  const text = pageText.replace(/[ \t　]+/g, " ");

  for (const pattern of PATTERNS) {
    const match = pattern.exec(text);

    if (match) {
      const start = Math.max(0, match.index - 15);
      return text
        .slice(start, match.index + match[0].length + 10)
        .replace(/\s+/g, " ")
        .trim();
    }
  }

  return null;
};
