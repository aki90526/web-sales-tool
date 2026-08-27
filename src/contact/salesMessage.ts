export type SalesMessageInput = {
  leadType: string;
  recommendedApproach: string;
  salesMessageDraft: string;
};

export const CONTACT_SENDER = {
  companyName: "aaWebCreate",
  name: "阿部 祥士",
  nameRoman: "Abe Akihito",
  tel: "09062121580",
  chatworkId: "abeAawc",
  email: "abe@aawebcreate.com",
  url: "https://aawebcreate.com/"
} as const;

const SIGNATURE = [
  CONTACT_SENDER.companyName,
  `${CONTACT_SENDER.name} / ${CONTACT_SENDER.nameRoman}`,
  `TEL : ${CONTACT_SENDER.tel}`,
  `チャットワークID : ${CONTACT_SENDER.chatworkId}`,
  `Email : ${CONTACT_SENDER.email}`,
  `URL : ${CONTACT_SENDER.url}`
].join("\n");

const OPT_OUT_NOTICE =
  "※今後このようなご連絡が不要な場合は、お手数ですが本メールへの返信にてお知らせください。以後のご連絡を控えます。";

export const buildSalesSubject = (leadType: string, recommendedApproach: string): string => {
  if (leadType === "広告代理店" || leadType === "Web制作会社") {
    return "Web制作・コーディングの外部パートナーについて";
  }

  if (recommendedApproach === "LP制作") {
    return "貴社Webサイト・LP改善について";
  }

  if (recommendedApproach === "保守・更新" || recommendedApproach === "WordPress改修") {
    return "貴社Webサイトの更新・改善について";
  }

  return "貴社Webサイトの改善について";
};

export const buildSalesBody = (draft: string): string => {
  const parts = [draft.trim()];

  if (!draft.includes("今後このようなご連絡が不要") && !draft.includes("以後のご連絡を控え")) {
    parts.push(OPT_OUT_NOTICE);
  }

  if (!draft.includes("aaWebCreate") || !draft.includes("abe@aawebcreate.com")) {
    parts.push(SIGNATURE);
  }

  return parts.join("\n\n");
};
