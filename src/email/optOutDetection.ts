// 返信本文から「配信停止・今後の営業連絡お断り」の意思表示を検出する。
// 引用部分（こちらが送った本文）を誤検出しないよう、引用行と「〜書きました」以降は除いて判定する。

const PATTERNS: RegExp[] = [
  /配信(を)?(停止|解除|中止)/,
  /(メール|連絡|営業|案内|送信).{0,8}(の)?(配信|送信)?(を)?(停止|中止|やめて|控えて|お控え|ご遠慮|遠慮)/,
  /今後(の)?(一切)?(ご)?(連絡|営業|メール|送信|案内|ご案内).{0,12}(不要|結構|お断り|ご遠慮|遠慮|控え|やめ|停止|不可)/,
  /(営業|セールス|勧誘|宣伝|広告)(の)?(メール|連絡|電話)?.{0,6}(は)?(お断り|ご遠慮|遠慮|不要|禁止)/,
  /(送らないで|送信しないで|連絡しないで|連絡をしないで|ご連絡はご遠慮|ご連絡は不要|ご連絡不要)/,
  /(リスト|宛先|配信先|登録)(から|の).{0,6}(削除|除外|外して)/,
  /\bunsubscribe\b/i,
  /\b(stop|do not|don't)\s+(emailing|contacting|sending)\b/i,
  /\bremove (me|us) from\b/i
];

const stripQuotedText = (text: string): string => {
  const lines = text.split(/\r?\n/);
  const kept: string[] = [];

  for (const line of lines) {
    const trimmed = line.trim();

    if (/^(-{2,}\s*(original message|元のメッセージ)|on .+ wrote:|.+に書きました[:：]?$|.+ wrote:$)/i.test(trimmed)) {
      break;
    }

    if (trimmed.startsWith(">") || trimmed.startsWith("＞")) {
      continue;
    }

    kept.push(line);
  }

  return kept.join("\n");
};

// 該当すれば根拠となった文言（前後を含む短い抜粋）を返し、なければ null
export const detectOptOut = (replyText: string): string | null => {
  const body = stripQuotedText(replyText);

  for (const pattern of PATTERNS) {
    const match = pattern.exec(body);

    if (match) {
      const start = Math.max(0, match.index - 10);
      return body
        .slice(start, match.index + match[0].length + 10)
        .replace(/\s+/g, " ")
        .trim();
    }
  }

  return null;
};
