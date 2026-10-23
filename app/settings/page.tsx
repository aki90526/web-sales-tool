"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Save } from "lucide-react";

type Intervals = { firstIntervalDays: number; laterIntervalDays: number; recheckIntervalDays: number };

type FollowUp = {
  templateId: string;
  templateName: string;
  targetLeadTypes: string;
  channel: "メール" | "フォーム" | "";
  status: string;
  subject: string;
  body: string;
};

type SettingsResponse = { intervals: Intervals; followUps: FollowUp[]; placeholders: string[] };

const leadTypeForPreview = (targetLeadTypes: string): string => (targetLeadTypes.includes("直クライアント") ? "直クライアント" : "Web制作会社");

function TemplateEditor({
  template,
  placeholders,
  onChange
}: {
  template: FollowUp;
  placeholders: string[];
  onChange: (next: FollowUp) => void;
}) {
  const [preview, setPreview] = useState<{ subject: string; body: string } | null>(null);
  const [previewError, setPreviewError] = useState("");
  const bodyRef = useRef<HTMLTextAreaElement>(null);

  // 入力が止まってから、サーバーで差し込み後の文面を作って表示する
  useEffect(() => {
    const timer = window.setTimeout(async () => {
      try {
        const response = await fetch("/api/settings/preview", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            subject: template.subject,
            body: template.body,
            channel: template.channel,
            leadType: leadTypeForPreview(template.targetLeadTypes)
          })
        });
        const data = (await response.json()) as { subject?: string; body?: string; message?: string };

        if (!response.ok || data.subject === undefined || data.body === undefined) {
          throw new Error(data.message ?? "プレビューを作れませんでした");
        }

        setPreview({ subject: data.subject, body: data.body });
        setPreviewError("");
      } catch (error) {
        setPreviewError(error instanceof Error ? error.message : "プレビューを作れませんでした");
      }
    }, 500);

    return () => window.clearTimeout(timer);
  }, [template.subject, template.body, template.channel, template.targetLeadTypes]);

  const insertPlaceholder = (placeholder: string) => {
    const element = bodyRef.current;
    const start = element?.selectionStart ?? template.body.length;
    const end = element?.selectionEnd ?? template.body.length;

    onChange({ ...template, body: `${template.body.slice(0, start)}${placeholder}${template.body.slice(end)}` });
    window.setTimeout(() => {
      element?.focus();
      element?.setSelectionRange(start + placeholder.length, start + placeholder.length);
    }, 0);
  };

  return (
    <div className="settings-template">
      <div className="settings-template-head">
        <strong>{template.templateName}</strong>
        <span className="method-badge">{template.channel || "メール・フォーム共通"}</span>
        {template.status && template.status !== "使用中" && <span className="method-badge">{template.status}</span>}
      </div>

      <div className="settings-template-grid">
        <div className="field-grid">
          <label className="field full">
            件名
            <input value={template.subject} maxLength={200} onChange={(event) => onChange({ ...template, subject: event.target.value })} />
          </label>
          <label className="field full">
            本文
            <textarea ref={bodyRef} rows={16} maxLength={5000} value={template.body} onChange={(event) => onChange({ ...template, body: event.target.value })} />
          </label>
          <div className="field full">
            <span>差し込み項目（クリックで本文のカーソル位置に入ります）</span>
            <div className="btn-row-tight settings-placeholders">
              {placeholders.map((placeholder) => (
                <button key={placeholder} type="button" className="btn secondary" onClick={() => insertPlaceholder(placeholder)}>
                  {placeholder}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="settings-preview">
          <p className="panel-caption">プレビュー（会社名は「株式会社サンプル」、前回送信月は3か月前で表示）</p>
          {previewError ? (
            <p className="settings-error">{previewError}</p>
          ) : preview ? (
            <>
              <p className="settings-preview-subject">件名: {preview.subject}</p>
              <pre className="settings-preview-body">{preview.body}</pre>
            </>
          ) : (
            <p className="panel-caption">読み込み中...</p>
          )}
        </div>
      </div>
    </div>
  );
}

export default function SettingsPage() {
  const [data, setData] = useState<SettingsResponse | null>(null);
  const [intervals, setIntervals] = useState<Intervals | null>(null);
  const [followUps, setFollowUps] = useState<FollowUp[]>([]);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ type: "ok" | "error"; text: string } | null>(null);

  const apply = useCallback((next: SettingsResponse) => {
    setData(next);
    setIntervals(next.intervals);
    setFollowUps(next.followUps);
  }, []);

  useEffect(() => {
    fetch("/api/settings")
      .then(async (response) => {
        const body = (await response.json()) as SettingsResponse & { message?: string };

        if (!response.ok) {
          throw new Error(body.message ?? "設定を読み込めませんでした");
        }

        apply(body);
      })
      .catch((error: unknown) => setMessage({ type: "error", text: error instanceof Error ? error.message : "設定を読み込めませんでした" }));
  }, [apply]);

  const save = async () => {
    if (!intervals) return;

    setSaving(true);
    setMessage(null);

    try {
      const response = await fetch("/api/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          intervals,
          followUps: followUps.map((entry) => ({ templateId: entry.templateId, subject: entry.subject, body: entry.body }))
        })
      });
      const body = (await response.json()) as SettingsResponse & { message?: string };

      if (!response.ok) {
        throw new Error(body.message ?? "保存できませんでした");
      }

      apply(body);
      setMessage({ type: "ok", text: "保存しました（スプレッドシートにも反映されています）" });
    } catch (error) {
      setMessage({ type: "error", text: error instanceof Error ? error.message : "保存できませんでした" });
    } finally {
      setSaving(false);
    }
  };

  const setInterval = (key: keyof Intervals, value: string) => {
    if (!intervals) return;
    setIntervals({ ...intervals, [key]: value === "" ? 0 : Number(value) });
  };

  return (
    <div className="page-stack">
      <div className="page-heading">
        <div>
          <h2>設定</h2>
          <p>再送の間隔と、再送用の文面を変更します。内容はスプレッドシート（設定・メッセージテンプレート）と同じものです。</p>
        </div>
        <button type="button" className="btn primary" onClick={save} disabled={saving || !intervals}>
          <Save size={16} />
          {saving ? "保存中..." : "保存"}
        </button>
      </div>

      {message && <p className={message.type === "ok" ? "settings-ok" : "settings-error"}>{message.text}</p>}

      {intervals && (
        <section className="form-panel">
          <div className="panel-header">
            <div>
              <h3 className="panel-title">再送・再確認の間隔</h3>
              <p className="panel-caption">
                「送信済み」のまま返信がないリードは、前回送信日からの日数が過ぎると「送信待ち」に戻ります（毎朝の返信同期のときに判定。送信は手動のままです）。
              </p>
            </div>
          </div>
          <div className="field-grid">
            <label className="field">
              初回の再送まで（日）
              <input type="number" min={1} max={3650} value={intervals.firstIntervalDays || ""} onChange={(event) => setInterval("firstIntervalDays", event.target.value)} />
              <small className="panel-caption">1回目の送信から、2回目を送るまでの日数</small>
            </label>
            <label className="field">
              2回目以降の再送まで（日）
              <input type="number" min={1} max={3650} value={intervals.laterIntervalDays || ""} onChange={(event) => setInterval("laterIntervalDays", event.target.value)} />
              <small className="panel-caption">2回目の送信以降、次を送るまでの日数</small>
            </label>
            <label className="field">
              見送りの再確認（日）
              <input type="number" min={1} max={3650} value={intervals.recheckIntervalDays || ""} onChange={(event) => setInterval("recheckIntervalDays", event.target.value)} />
              <small className="panel-caption">
                「見送り」のリードの公式サイト・連絡先を確認し直す間隔。「除外」にしたリードと、返信のあったリードは対象外です
              </small>
            </label>
          </div>
        </section>
      )}

      {data && (
        <section className="form-panel">
          <div className="panel-header">
            <div>
              <h3 className="panel-title">再送の文面</h3>
              <p className="panel-caption">
                2回目以降の送信で自動的に使われます（メール用・フォーム用、制作会社向け・直クライアント向け）。署名と、配信停止のご案内（本文に無い場合）は自動で付きます。
              </p>
            </div>
          </div>
          <div className="settings-template-list">
            {followUps.length === 0 && <p className="panel-caption">再送用の文面がシートにありません（npm run settings:migrate-resend で追加できます）。</p>}
            {followUps.map((template, index) => (
              <TemplateEditor
                key={template.templateId}
                template={template}
                placeholders={data.placeholders}
                onChange={(next) => setFollowUps((current) => current.map((entry, entryIndex) => (entryIndex === index ? next : entry)))}
              />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
