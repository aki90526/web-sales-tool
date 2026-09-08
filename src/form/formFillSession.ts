import fs from "fs";
import path from "path";

export type LastFormFillSession = {
  leadId: string;
  companyName: string;
  formUrl: string;
  filledAt: string;
};

const sessionPath = path.resolve(process.cwd(), ".tmp", "last-form-fill.json");

export const saveLastFormFillSession = (session: LastFormFillSession): void => {
  fs.mkdirSync(path.dirname(sessionPath), { recursive: true });
  fs.writeFileSync(sessionPath, `${JSON.stringify(session, null, 2)}\n`, "utf8");
};

export const readLastFormFillSession = (): LastFormFillSession | null => {
  if (!fs.existsSync(sessionPath)) {
    return null;
  }

  const raw = fs.readFileSync(sessionPath, "utf8");
  const parsed = JSON.parse(raw) as Partial<LastFormFillSession>;

  if (!parsed.leadId || !parsed.companyName || !parsed.formUrl || !parsed.filledAt) {
    return null;
  }

  return {
    leadId: parsed.leadId,
    companyName: parsed.companyName,
    formUrl: parsed.formUrl,
    filledAt: parsed.filledAt
  };
};
