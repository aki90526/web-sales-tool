import { NextResponse } from "next/server";
import { loadConfig } from "../../../../src/config/env";
import { readAllLeadLogs, readLeadLog } from "../../../../src/domain/leadLog";
import { SHEETS } from "../../../../src/domain/lead";
import { fieldRangeForRow, readSalesManagementTable } from "../../../../src/google/salesManagementRepository";
import { createSheetsClient } from "../../../../src/google/sheetsClient";

export const dynamic = "force-dynamic";

const MAX_LENGTH = 200;
const NOTE_PREFIX = "状況を更新: ";

// リードごとのログ（新しい順）
export async function GET(request: Request) {
  try {
    const leadId = new URL(request.url).searchParams.get("leadId")?.trim() ?? "";

    if (!/^L-\d{1,6}$/.test(leadId)) {
      return NextResponse.json({ message: "leadId is invalid" }, { status: 400 });
    }

    const sheets = await createSheetsClient(loadConfig());

    return NextResponse.json({ leadId, entries: await readLeadLog(sheets, leadId) });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ message }, { status: 500 });
  }
}

// 操作者が手で書いた「状況」のログを、直す・消す（誤って登録したとき用）。システムが書いたログは、変更できない。
// 直したログが、いちばん新しい状況なら、営業管理の「現在の状況」も、同じ内容にそろえる
export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { leadId?: unknown; rowNumber?: unknown; at?: unknown; text?: unknown; delete?: unknown };
    const leadId = typeof body.leadId === "string" ? body.leadId.trim() : "";
    const rowNumber = typeof body.rowNumber === "number" ? body.rowNumber : 0;
    const at = typeof body.at === "string" ? body.at.trim() : "";
    const remove = body.delete === true;

    if (!/^L-\d{1,6}$/.test(leadId) || !Number.isInteger(rowNumber) || rowNumber < 2 || !at) {
      return NextResponse.json({ message: "leadId / rowNumber / at が正しくありません" }, { status: 400 });
    }

    let newNote = "";

    if (!remove) {
      if (typeof body.text !== "string") {
        return NextResponse.json({ message: "text must be a string" }, { status: 400 });
      }

      newNote = body.text.replace(/\s*\n\s*/g, " ").trim();

      if (!newNote || newNote.length > MAX_LENGTH) {
        return NextResponse.json({ message: `状況は1〜${MAX_LENGTH}文字で入力してください` }, { status: 400 });
      }
    }

    const sheets = await createSheetsClient(loadConfig());
    const all = await readAllLeadLogs(sheets);
    // 行がずれていないか（別の操作で行が変わっていないか）を、日時・リード・種類・記録者で確かめる
    const target = all.find((entry) => entry.rowNumber === rowNumber);

    if (!target || target.leadId !== leadId || target.at !== at || target.kind !== "状況" || target.actor !== "手入力") {
      return NextResponse.json({ message: "このログは、変更できません（手入力の「状況」だけ変更できます。画面を更新してください）" }, { status: 409 });
    }

    if (!remove && !target.text.startsWith(NOTE_PREFIX)) {
      return NextResponse.json({ message: "「状況を更新」のログだけ、内容を直せます" }, { status: 409 });
    }

    const notes = all
      .filter((entry) => entry.leadId === leadId && entry.kind === "状況" && entry.actor === "手入力")
      .sort((a, b) => a.at.localeCompare(b.at));
    const isLatest = notes[notes.length - 1]?.rowNumber === rowNumber;
    const range = `'${SHEETS.leadLog}'!A${rowNumber}:F${rowNumber}`;

    if (remove) {
      // 行を詰めず、中身だけを消す（ほかのログの行番号が変わらないようにする）
      await sheets.updateValues(range, [["", "", "", "", "", ""]]);
    } else {
      await sheets.updateValues(range, [[`'${target.at}`, target.leadId, target.kind, `${NOTE_PREFIX}${newNote}`, target.actor, `編集前: ${target.text.replace(NOTE_PREFIX, "")}`]]);
    }

    // いちばん新しい状況を直した・消したときは、「現在の状況」をそろえる
    if (isLatest) {
      const previous = notes.length >= 2 ? notes[notes.length - 2] : null;
      const nextCurrent = remove
        ? previous && previous.text.startsWith(NOTE_PREFIX)
          ? previous.text.slice(NOTE_PREFIX.length)
          : ""
        : newNote;
      const table = await readSalesManagementTable(sheets);
      const lead = table.leads.find((entry) => entry.leadId === leadId);

      if (lead && table.columns.currentNote >= 0 && lead.currentNote !== nextCurrent) {
        await sheets.updateValues(fieldRangeForRow(table.columns, "currentNote", lead.rowNumber), [[nextCurrent]]);
      }
    }

    return NextResponse.json({ leadId, entries: await readLeadLog(sheets, leadId) });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ message }, { status: 500 });
  }
}
