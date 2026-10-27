"use client";

import { useEffect, useState } from "react";
import { Check, ExternalLink, X } from "lucide-react";

type Judgment = { url: string; label: string; ok: boolean; reason: string };

type Result = {
  leadId: string;
  companyName: string;
  officialSiteUrl: string;
  current: { formUrl: string; email: string; formJudgment: Judgment | null };
  candidates: Judgment[];
  recommendedFormUrl: string;
  foundEmail: { email: string; sourceUrl: string } | null;
};

// リードの連絡先を、公式サイトから探し直した結果（提案）を表示する。登録は、阿部がボタンを押したときだけ行う。
// AIは使わない（費用なし）。登録は、既存のフォームURL・メールアドレスの登録の処理を使う（ログにも残る）。
export default function ContactRediscoveryModal({
  leadId,
  companyName,
  onClose,
  onApplied
}: {
  leadId: string;
  companyName: string;
  onClose: () => void;
  onApplied: () => void;
}) {
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");
  const [applied, setApplied] = useState<string[]>([]);

  useEffect(() => {
    let active = true;

    fetch("/api/leads/rediscover", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ leadId })
    })
      .then(async (res) => {
        const body = await res.json();

        if (!res.ok) {
          throw new Error(body.message ?? `HTTP ${res.status}`);
        }

        if (active) {
          setResult(body as Result);
        }
      })
      .catch((err: unknown) => {
        if (active) {
          setError(err instanceof Error ? err.message : "探し直せませんでした");
        }
      });

    return () => {
      active = false;
    };
  }, [leadId]);

  const apply = async (kind: "form" | "email", value: string) => {
    setBusy(value);
    setError("");

    try {
      const res = await fetch(kind === "form" ? "/api/leads/form-url" : "/api/leads/email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(kind === "form" ? { leadId, contactFormUrl: value } : { leadId, email: value })
      });
      const body = await res.json();

      if (!res.ok) {
        throw new Error(body.message ?? `HTTP ${res.status}`);
      }

      setApplied((current) => [...current, value]);
      onApplied();
    } catch (err) {
      setError(err instanceof Error ? err.message : "登録できませんでした");
    } finally {
      setBusy("");
    }
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-panel rediscovery-modal" onClick={(event) => event.stopPropagation()}>
        <div className="modal-header">
          <div>
            <h3 className="panel-title">連絡先を再探索</h3>
            <p className="panel-caption">
              {leadId} {companyName}（公式サイトを調べ直します。AIは使わないので、費用はかかりません）
            </p>
          </div>
          <button className="btn secondary icon-only" type="button" onClick={onClose} title="閉じる">
            <X size={16} />
          </button>
        </div>

        {error && <p className="error-box">{error}</p>}
        {!result && !error && <p className="panel-caption">サイトを調べています（10〜30秒かかることがあります）...</p>}

        {result && (
          <div className="rediscovery-body">
            <section>
              <h4>いまの登録</h4>
              <p className="rediscovery-row">
                フォームURL:{" "}
                {result.current.formUrl ? (
                  <>
                    <a className="link-accent" href={result.current.formUrl} target="_blank" rel="noopener noreferrer">
                      {result.current.formUrl}
                    </a>
                    {result.current.formJudgment && (
                      <span className={result.current.formJudgment.ok ? "rediscovery-ok" : "rediscovery-ng"}>
                        {result.current.formJudgment.ok ? "使えそうです" : `使えません: ${result.current.formJudgment.reason}`}
                      </span>
                    )}
                  </>
                ) : (
                  "なし"
                )}
              </p>
              <p className="rediscovery-row">メール: {result.current.email || "なし"}</p>
            </section>

            <section>
              <h4>公式サイトで見つけたフォームの候補</h4>
              {result.candidates.length === 0 && <p className="panel-caption">問い合わせらしいページが見つかりませんでした。</p>}
              {result.candidates.map((candidate) => (
                <div key={candidate.url} className="rediscovery-candidate">
                  <div>
                    <a className="link-accent" href={candidate.url} target="_blank" rel="noopener noreferrer">
                      {candidate.url} <ExternalLink size={12} />
                    </a>
                    <span className={candidate.ok ? "rediscovery-ok" : "rediscovery-ng"}>
                      {candidate.ok ? "使えそうです" : `使えません: ${candidate.reason}`}
                    </span>
                  </div>
                  {candidate.ok &&
                    (applied.includes(candidate.url) ? (
                      <span className="rediscovery-ok">
                        <Check size={13} /> 登録しました
                      </span>
                    ) : (
                      <button type="button" className="btn primary" disabled={busy !== ""} onClick={() => void apply("form", candidate.url)}>
                        {busy === candidate.url ? "登録中..." : "このURLを登録"}
                      </button>
                    ))}
                </div>
              ))}
            </section>

            <section>
              <h4>メールアドレス</h4>
              {result.foundEmail ? (
                <div className="rediscovery-candidate">
                  <div>
                    <strong>{result.foundEmail.email}</strong>
                    <span className="panel-caption">（出典: {result.foundEmail.sourceUrl}）</span>
                  </div>
                  {applied.includes(result.foundEmail.email) ? (
                    <span className="rediscovery-ok">
                      <Check size={13} /> 登録しました
                    </span>
                  ) : (
                    <button type="button" className="btn primary" disabled={busy !== ""} onClick={() => void apply("email", result.foundEmail!.email)}>
                      {busy === result.foundEmail.email ? "登録中..." : "このメールアドレスを登録"}
                    </button>
                  )}
                </div>
              ) : (
                <p className="panel-caption">新しく見つかったメールアドレスは、ありません。</p>
              )}
            </section>

            <p className="panel-caption">
              使えるものが無いときは、見送りにして、メモや「現在の状況」に理由を書くのがおすすめです。メールを登録すると、連絡方法はメールに切り替わります。
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
