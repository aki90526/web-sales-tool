import { execFile } from "child_process";
import fs from "fs";
import path from "path";
import { NextResponse } from "next/server";
import { FormSample, listFormSamples, readFormSample, writeFormSample } from "../../../src/form/formSamples";

export const dynamic = "force-dynamic";

const ROOT = path.resolve(process.cwd());
const FIXTURE_DIR = path.join(ROOT, "test/form-fixtures");

const summarize = (sample: FormSample) => ({
  id: sample.id,
  leadId: sample.leadId,
  companyName: sample.companyName,
  formUrl: sample.formUrl,
  capturedAt: sample.capturedAt,
  hasHtml: "html" in sample.snapshot,
  filled: sample.filled,
  selected: sample.selected,
  warnings: sample.warnings,
  confirmStatus: sample.confirmStatus,
  confirmDetail: sample.confirmDetail,
  captcha: sample.captcha,
  status: sample.status,
  note: sample.note,
  reviewedAt: sample.reviewedAt,
  fixtureName: sample.fixtureName
});

// 自動入力のフォーム記録の一覧と、成績（記録した件数・確認済みの正答率など）
export async function GET() {
  const samples = listFormSamples();
  const reviewed = samples.filter((sample) => sample.status !== "pending");
  const ok = samples.filter((sample) => sample.status === "ok").length;
  const clean = samples.filter((sample) => sample.warnings.length === 0 && sample.confirmStatus === "advanced").length;
  const advanced = samples.filter((sample) => sample.confirmStatus === "advanced").length;

  return NextResponse.json({
    stats: {
      total: samples.length,
      pending: samples.length - reviewed.length,
      ok,
      ng: reviewed.length - ok,
      // 人が確認した判定の、正答率（確認済みのうち「正しい」の割合）
      accuracy: reviewed.length > 0 ? Math.round((ok / reviewed.length) * 100) : null,
      // 警告なしで確認画面まで進めた割合（自動で完結した割合）
      cleanRate: samples.length > 0 ? Math.round((clean / samples.length) * 100) : null,
      advancedRate: samples.length > 0 ? Math.round((advanced / samples.length) * 100) : null
    },
    samples: samples.map(summarize)
  });
}

const run = (command: string, args: string[], timeoutMs: number): Promise<{ ok: boolean; output: string }> =>
  new Promise((resolve) => {
    execFile(command, args, { cwd: ROOT, timeout: timeoutMs }, (error, stdout, stderr) => {
      resolve({ ok: !error, output: `${stdout}${stderr}`.trim() });
    });
  });

// 「正しい」: テスト用データ（test/form-fixtures）に加える。「間違いあり」: 間違いのメモを付けて、改善の対象にする
export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { id?: unknown; verdict?: unknown; note?: unknown };
    const id = typeof body.id === "string" ? body.id : "";
    const sample = /^[0-9a-f]{10}$/.test(id) ? readFormSample(id) : null;

    if (!sample) {
      return NextResponse.json({ message: "記録が見つかりません" }, { status: 404 });
    }

    if (body.verdict !== "ok" && body.verdict !== "ng") {
      return NextResponse.json({ message: "verdict must be ok or ng" }, { status: 400 });
    }

    const note = typeof body.note === "string" ? body.note.trim().slice(0, 500) : "";

    if (body.verdict === "ng") {
      writeFormSample({ ...sample, status: "ng", note, reviewedAt: new Date().toISOString() });
      return NextResponse.json({ ok: true });
    }

    const name = `sample-${sample.id}`;
    const file = path.join(FIXTURE_DIR, `${name}.html`);

    if (!fs.existsSync(file)) {
      if ("html" in sample.snapshot) {
        fs.writeFileSync(
          file,
          `<!doctype html>\n<!-- source: ${sample.formUrl} -->\n<html lang="ja"><head><meta charset="utf-8"><title>${name}</title></head><body>\n${sample.snapshot.html}\n</body></html>\n`
        );
      } else {
        // 構造を保存できなかった（外部のフォームなど）ときは、ページを開き直して取り出す
        const saved = await run("npm", ["run", "-s", "test:forms:save", "--", sample.formUrl, "--name", name], 120_000);

        if (!fs.existsSync(file)) {
          return NextResponse.json({ message: `テスト用データにできませんでした（フォームを取り出せません）: ${saved.output.slice(-200)}` }, { status: 422 });
        }
      }
    }

    // 現在の判定結果を、期待値として保存する（「正しい」と確認したため）
    const updated = await run("npm", ["run", "-s", "test:forms", "--", name, "--update"], 180_000);

    if (!updated.ok) {
      return NextResponse.json({ message: `期待値を作れませんでした: ${updated.output.slice(-200)}` }, { status: 500 });
    }

    writeFormSample({ ...sample, status: "ok", note, reviewedAt: new Date().toISOString(), fixtureName: name });

    return NextResponse.json({ ok: true, fixtureName: name });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ message }, { status: 500 });
  }
}
