// 問い合わせページの本文から「営業・勧誘目的の連絡お断り」の記載を検出する。
// 収集時に見逃した場合や、登録後にサイトへ追記された場合に備えて、フォーム自動入力の直前に使う。

const PATTERNS: RegExp[] = [
  /営業(目的|活動|メール|電話|連絡|のお問い?合わせ|のご連絡|のご案内|の連絡|のメール|の電話|行為).{0,14}(禁止|お断り|ご遠慮|遠慮|不可|ご容赦|返信.{0,6}(いたしかね|致しかね|できません))/,
  /(セールス|売り込み|勧誘|販売)(目的|活動|行為)?.{0,14}(禁止|お断り|ご遠慮|遠慮|不可|ご容赦)/,
  /(広告|宣伝)(目的)?(の)?(メール|連絡|電話|お問い?合わせ|行為).{0,14}(禁止|お断り|ご遠慮|遠慮|不可|ご容赦)/,
  /お問い合わせフォーム.{0,20}営業.{0,12}(禁止|お断り|不可)/
];

// 電話・訪問・FAX だけを断る文言（「営業電話はお断り」など）は、メール・フォームでの連絡の禁止ではないので、除外の根拠にしない。
// メール・問い合わせ・フォーム・連絡一般にも触れているものは、禁止とみなす
const PHONE_OR_VISIT_ONLY = /(電話|TEL|訪問|来訪|飛び込み|FAX|ファックス)/i;
const MAIL_OR_FORM_ALSO = /(メール|e-?mail|問い?合わ?せ|フォーム|連絡|ご連絡|セールス|売り込み|勧誘|営業活動|営業目的|営業行為)/i;

// 該当すれば根拠となった文言（前後を含む短い抜粋）を返し、なければ null
export const detectSalesForbidden = (pageText: string): string | null => {
  const text = pageText.replace(/[ \t　]+/g, " ");

  for (const pattern of PATTERNS) {
    const flags = pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`;

    for (const match of text.matchAll(new RegExp(pattern.source, flags))) {
      const matched = match[0];

      // 「営業のお電話はお断り」のように、電話・訪問だけを断る文言は、禁止とはみなさない
      if (PHONE_OR_VISIT_ONLY.test(matched) && !MAIL_OR_FORM_ALSO.test(matched.replace(/営業(の|を)?(お)?電話/g, ""))) {
        continue;
      }

      const start = Math.max(0, (match.index ?? 0) - 15);

      return text
        .slice(start, (match.index ?? 0) + matched.length + 10)
        .replace(/\s+/g, " ")
        .trim();
    }
  }

  return null;
};
