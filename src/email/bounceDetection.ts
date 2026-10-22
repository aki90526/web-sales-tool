// 不達通知（バウンスメール）から、宛先と理由を読み取る。

export type BounceInfo = {
  recipient: string;
  // 例: 5.7.1（取れなければ空）
  status: string;
  // 相手サーバーからの理由（短く整形したもの）
  reason: string;
  // 永続的なエラー（アドレスが存在しない・拒否など）か。一時的なエラー（容量超過・一時障害）は false
  permanent: boolean;
};

const EMAIL_PATTERN = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/;

// 一時的な理由（あとで届く可能性がある）。ステータスが 5.x でも、永続扱いにしない
const TEMPORARY_REASON = /(mailbox (is )?full|over ?quota|quota exceeded|temporar|try again|greylist|容量|一時的)/i;

export const isBounceSubject = (subject: string): boolean => {
  return /(undelivered mail|delivery status notification|mail delivery (failed|system|subsystem)|returned mail|failure notice|配信(できません|エラー|失敗)|メール(配信|送信)エラー)/i.test(subject);
};

export const parseBounce = (text: string): BounceInfo | null => {
  const finalRecipient = /Final-Recipient:\s*rfc822;\s*(\S+)/i.exec(text)?.[1] ?? "";
  const originalRecipient = /Original-Recipient:\s*rfc822;\s*(\S+)/i.exec(text)?.[1] ?? "";
  const status = /^\s*Status:\s*(\d\.\d{1,3}\.\d{1,3})/im.exec(text)?.[1] ?? "";
  const diagnostic = /Diagnostic-Code:\s*(?:smtp;)?\s*([\s\S]*?)(?:\r?\n(?!\s)|$)/i.exec(text)?.[1] ?? "";
  // 読み取れない場合は、本文の「<宛先>: host ... said: 554 ...」から拾う
  const bodyLine = /<([^>\s]+@[^>\s]+)>:\s*(?:host [^\n]*?said:\s*)?([^\n]*(?:\n[ \t][^\n]*)*)/i.exec(text);
  const recipient = (EMAIL_PATTERN.exec(finalRecipient)?.[0] ?? EMAIL_PATTERN.exec(originalRecipient)?.[0] ?? bodyLine?.[1] ?? "").toLowerCase();

  if (!recipient) {
    return null;
  }

  const reason = (diagnostic || bodyLine?.[2] || "").replace(/\s+/g, " ").trim().slice(0, 160);
  const action = /^\s*Action:\s*(\w+)/im.exec(text)?.[1]?.toLowerCase() ?? "";
  const statusPermanent = status.startsWith("5") || (!status && /(^|\s)5\d\d(\s|-)/.test(reason));
  const permanent = (action === "" || action === "failed") && statusPermanent && !TEMPORARY_REASON.test(reason);

  return { recipient, status, reason, permanent };
};
