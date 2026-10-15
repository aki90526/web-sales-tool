import { SalesManagementLead } from "./salesManagementRepository";

export type BookingNotification = {
  when: string;
  name: string;
  company: string;
  email: string;
  meetUrl: string;
};

// 予約システムの通知メール（「新しい面談の予約が入りました」）から、予約者の情報を読み取る
export const parseBookingNotification = (text: string): BookingNotification | null => {
  const when = text.match(/■\s*日時\s*[\r\n]+\s*(.+)/)?.[1]?.trim() ?? "";
  const email = text.match(/メールアドレス\s*[：:]\s*([^\s]+@[^\s]+)/)?.[1]?.trim() ?? "";

  if (!when || !email) {
    return null;
  }

  return {
    when,
    name: text.match(/お名前\s*[：:]\s*(.+)/)?.[1]?.trim() ?? "",
    company: text.match(/会社名\s*[：:]\s*(.+)/)?.[1]?.trim() ?? "",
    email,
    meetUrl: text.match(/https:\/\/meet\.google\.com\/[a-z0-9-]+/i)?.[0] ?? ""
  };
};

const FREE_MAIL_DOMAINS = /^(gmail\.com|yahoo\.co\.jp|yahoo\.com|outlook\.com|outlook\.jp|hotmail\.com|hotmail\.co\.jp|icloud\.com|me\.com|docomo\.ne\.jp|ezweb\.ne\.jp|au\.com|softbank\.ne\.jp|i\.softbank\.jp|nifty\.com|biglobe\.ne\.jp|live\.jp|live\.com)$/i;

const hostOf = (url: string): string => {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return "";
  }
};

const normalizeCompany = (name: string): string =>
  name
    .replace(/(株式会社|有限会社|合同会社|一般社団法人|\(株\)|（株）|㈱)/g, "")
    .replace(/[\s　・･\-－]/g, "")
    .toLowerCase();

const domainsMatch = (emailDomain: string, other: string): boolean =>
  Boolean(other) && (emailDomain === other || emailDomain.endsWith(`.${other}`) || other.endsWith(`.${emailDomain}`));

// 予約者のメールアドレスのドメイン、または会社名から、該当するリードを探す
export const matchBookingToLeads = (booking: BookingNotification, leads: SalesManagementLead[]): SalesManagementLead[] => {
  const emailDomain = booking.email.split("@")[1]?.toLowerCase() ?? "";
  const companyKey = normalizeCompany(booking.company);
  const byDomain = FREE_MAIL_DOMAINS.test(emailDomain)
    ? []
    : leads.filter((lead) => {
        const leadEmailDomain = lead.emailAddress.split("@")[1]?.toLowerCase() ?? "";

        return domainsMatch(emailDomain, hostOf(lead.officialSiteUrl)) || domainsMatch(emailDomain, leadEmailDomain);
      });

  if (byDomain.length > 0) {
    return byDomain;
  }

  if (companyKey.length < 2) {
    return [];
  }

  return leads.filter((lead) => {
    const leadKey = normalizeCompany(lead.companyName);

    return leadKey.length >= 2 && (leadKey === companyKey || leadKey.includes(companyKey) || companyKey.includes(leadKey));
  });
};
