"use client";

import { useEffect, useMemo, useState } from "react";

type MonthlyRow = {
  month: string;
  email: number;
  form: number;
  bounced: number;
  contacted: number;
  reactions: number;
};

type Period = 6 | 12;

type Series = { key: string; label: string; color: string; values: number[] };

type Tooltip = { index: number; x: number; y: number } | null;

const WIDTH = 360;
const HEIGHT = 230;
const PAD = { top: 22, right: 14, bottom: 30, left: 36 };
const PLOT_W = WIDTH - PAD.left - PAD.right;
const PLOT_H = HEIGHT - PAD.top - PAD.bottom;

// 「2026-09」→「9月」。年の最初の月と、先頭の月だけ「26/9月」のように年を添える
const monthLabel = (month: string, index: number): string => {
  const [year, mm] = month.split("-");
  const m = Number(mm);
  return index === 0 || m === 1 ? `${year.slice(2)}/${m}月` : `${m}月`;
};

// 縦軸の最大値を、切りのよい数にそろえる（0 / 中間 / 最大の3目盛り）
const niceMax = (value: number): number => {
  if (value <= 4) return 4;
  const magnitude = 10 ** Math.floor(Math.log10(value));
  const step = [1, 2, 4, 5, 10].map((unit) => unit * magnitude).find((unit) => unit >= value) ?? value;
  return step;
};

const percent = (reactions: number, contacted: number): number => (contacted > 0 ? Math.round((reactions / contacted) * 1000) / 10 : 0);

function Axes({ max, labels, formatTick }: { max: number; labels: string[]; formatTick: (value: number) => string }) {
  const band = PLOT_W / labels.length;
  const ticks = [0, max / 2, max];

  return (
    <g>
      {ticks.map((tick) => {
        const y = PAD.top + PLOT_H - (tick / max) * PLOT_H;
        return (
          <g key={tick}>
            <line x1={PAD.left} x2={WIDTH - PAD.right} y1={y} y2={y} className={tick === 0 ? "viz-axis" : "viz-grid"} />
            <text x={PAD.left - 6} y={y + 3.5} textAnchor="end" className="viz-tick">
              {formatTick(tick)}
            </text>
          </g>
        );
      })}
      {labels.map((label, index) =>
        // 月が多いときは、ラベルが重ならないよう、1つおき（最新の月は必ず表示）にする
        (labels.length - 1 - index) % (labels.length > 8 ? 2 : 1) === 0 ? (
          <text key={`${label}-${index}`} x={PAD.left + band * index + band / 2} y={HEIGHT - 10} textAnchor="middle" className="viz-tick">
            {label}
          </text>
        ) : null
      )}
    </g>
  );
}

// ホバー（キーボードのフォーカスも）で、月ごとの値を出すツールチップ
function TooltipBox({
  tooltip,
  title,
  rows
}: {
  tooltip: Tooltip;
  title: string;
  rows: Array<{ color: string; label: string; value: string }>;
}) {
  if (!tooltip) return null;

  return (
    <div className="viz-tooltip" style={{ left: `${(tooltip.x / WIDTH) * 100}%`, top: `${(tooltip.y / HEIGHT) * 100}%` }} role="status">
      <div className="viz-tooltip-title">{title}</div>
      {rows.map((row) => (
        <div key={row.label} className="viz-tooltip-row">
          <span className="viz-key" style={{ background: row.color }} />
          <strong>{row.value}</strong>
          <span>{row.label}</span>
        </div>
      ))}
    </div>
  );
}

// 縦棒グラフ。複数の系列は積み上げる（セグメントの間は2pxの隙間、上端だけ角を丸める）
function ColumnChart({ title, description, months, series, unit }: { title: string; description: string; months: string[]; series: Series[]; unit: string }) {
  const [tooltip, setTooltip] = useState<Tooltip>(null);
  const totals = months.map((_, index) => series.reduce((sum, item) => sum + item.values[index], 0));
  const max = niceMax(Math.max(...totals, 1));
  const band = PLOT_W / months.length;
  const barWidth = Math.min(24, band * 0.62);
  const labels = months.map(monthLabel);
  const lastIndex = months.length - 1;

  return (
    <figure className="viz-card">
      <figcaption>
        <h4>{title}</h4>
        <p>{description}</p>
        {series.length > 1 && (
          <ul className="viz-legend">
            {series.map((item) => (
              <li key={item.key}>
                <span className="viz-key viz-key-box" style={{ background: item.color }} />
                {item.label}
              </li>
            ))}
          </ul>
        )}
      </figcaption>
      <div className="viz-plot">
        <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} role="img" aria-label={`${title}（${labels[0]}から${labels[lastIndex]}）`} onPointerLeave={() => setTooltip(null)}>
          <Axes max={max} labels={labels} formatTick={(value) => String(Math.round(value))} />
          {months.map((month, index) => {
            const cx = PAD.left + band * index + band / 2;
            let offset = 0;
            const segments = series.filter((item) => item.values[index] > 0);

            return (
              <g key={month}>
                {segments.map((item, order) => {
                  const height = (item.values[index] / max) * PLOT_H;
                  const gap = order > 0 ? 2 : 0;
                  const y = PAD.top + PLOT_H - offset - height;
                  const isTop = order === segments.length - 1;
                  const h = Math.max(height - gap, 1);
                  offset += height;
                  // 上端だけ4pxの角丸、下（基準線側）は四角
                  const r = isTop ? Math.min(4, h) : 0;
                  const x0 = cx - barWidth / 2;
                  const x1 = cx + barWidth / 2;
                  const d = `M${x0},${y + h} L${x0},${y + r} Q${x0},${y} ${x0 + r},${y} L${x1 - r},${y} Q${x1},${y} ${x1},${y + r} L${x1},${y + h} Z`;
                  return <path key={item.key} d={d} fill={item.color} />;
                })}
                {totals[index] > 0 && index === lastIndex && (
                  <text x={cx} y={PAD.top + PLOT_H - (totals[index] / max) * PLOT_H - 6} textAnchor="middle" className="viz-value">
                    {totals[index]}
                  </text>
                )}
                {/* 棒より広い、見えないホバー領域（月の帯いっぱい） */}
                <rect
                  x={PAD.left + band * index}
                  y={PAD.top}
                  width={band}
                  height={PLOT_H}
                  fill="transparent"
                  tabIndex={0}
                  aria-label={`${labels[index]}: ${series.map((item) => `${item.label} ${item.values[index]}${unit}`).join("、")}`}
                  onPointerMove={() => setTooltip({ index, x: cx, y: PAD.top + PLOT_H - (totals[index] / max) * PLOT_H })}
                  onFocus={() => setTooltip({ index, x: cx, y: PAD.top + PLOT_H - (totals[index] / max) * PLOT_H })}
                  onBlur={() => setTooltip(null)}
                  className="viz-hit"
                />
              </g>
            );
          })}
          {tooltip && (
            <rect x={PAD.left + band * tooltip.index} y={PAD.top} width={band} height={PLOT_H} className="viz-hover-band" pointerEvents="none" />
          )}
        </svg>
        <TooltipBox
          tooltip={tooltip}
          title={tooltip ? labels[tooltip.index] : ""}
          rows={tooltip ? [...series].reverse().map((item) => ({ color: item.color, label: item.label, value: `${item.values[tooltip.index]}${unit}` })) : []}
        />
      </div>
    </figure>
  );
}

// 折れ線グラフ（1系列）。ホバーすると、いちばん近い月に縦線が出る
function LineChart({
  title,
  description,
  months,
  values,
  color,
  detail
}: {
  title: string;
  description: string;
  months: string[];
  values: number[];
  color: string;
  detail: (index: number) => string;
}) {
  const [tooltip, setTooltip] = useState<Tooltip>(null);
  const max = niceMax(Math.max(...values, 1));
  const band = PLOT_W / months.length;
  const labels = months.map(monthLabel);
  const point = (index: number) => ({ x: PAD.left + band * index + band / 2, y: PAD.top + PLOT_H - (values[index] / max) * PLOT_H });
  const path = values.map((_, index) => `${index === 0 ? "M" : "L"}${point(index).x},${point(index).y}`).join(" ");
  const lastIndex = months.length - 1;

  const nearest = (event: React.PointerEvent<SVGSVGElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const x = ((event.clientX - rect.left) / rect.width) * WIDTH;
    const index = Math.max(0, Math.min(lastIndex, Math.floor((x - PAD.left) / band)));
    setTooltip({ index, ...point(index) });
  };

  return (
    <figure className="viz-card">
      <figcaption>
        <h4>{title}</h4>
        <p>{description}</p>
      </figcaption>
      <div className="viz-plot">
        <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} role="img" aria-label={`${title}（${labels[0]}から${labels[lastIndex]}）`} onPointerMove={nearest} onPointerLeave={() => setTooltip(null)}>
          <Axes max={max} labels={labels} formatTick={(value) => `${Math.round(value)}%`} />
          {tooltip && <line x1={tooltip.x} x2={tooltip.x} y1={PAD.top} y2={PAD.top + PLOT_H} className="viz-grid viz-crosshair" />}
          <path d={path} fill="none" stroke={color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
          {values.map((value, index) => {
            const { x, y } = point(index);
            return (
              <g key={months[index]}>
                {/* 2pxの面の色のリングで、線や点と重なっても読めるようにする */}
                <circle cx={x} cy={y} r={6} className="viz-ring" />
                <circle cx={x} cy={y} r={4} fill={color} />
                <rect
                  x={PAD.left + band * index}
                  y={PAD.top}
                  width={band}
                  height={PLOT_H}
                  fill="transparent"
                  tabIndex={0}
                  aria-label={`${labels[index]}: ${value}%`}
                  onFocus={() => setTooltip({ index, x, y })}
                  onBlur={() => setTooltip(null)}
                  className="viz-hit"
                />
              </g>
            );
          })}
          <text x={point(lastIndex).x} y={point(lastIndex).y - 11} textAnchor="middle" className="viz-value">
            {values[lastIndex]}%
          </text>
        </svg>
        <TooltipBox
          tooltip={tooltip}
          title={tooltip ? labels[tooltip.index] : ""}
          rows={tooltip ? [{ color, label: detail(tooltip.index), value: `${values[tooltip.index]}%` }] : []}
        />
      </div>
    </figure>
  );
}

// 月別の送信数・反応数・反応率のグラフ。表でも確認できる
export default function MonthlyCharts() {
  const [rows, setRows] = useState<MonthlyRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [period, setPeriod] = useState<Period>(6);
  const [showTable, setShowTable] = useState(false);

  useEffect(() => {
    fetch("/api/monthly-stats", { cache: "no-store" })
      .then((res) => res.json())
      .then((body) => {
        if (Array.isArray(body.months)) setRows(body.months as MonthlyRow[]);
        else setError(body.message ?? "読み込みに失敗しました");
      })
      .catch(() => setError("読み込みに失敗しました"));
  }, []);

  const visible = useMemo(() => (rows ? rows.slice(-period) : []), [rows, period]);
  const months = visible.map((row) => row.month);

  return (
    <section className="panel viz-root">
      <div className="panel-header">
        <div>
          <h3 className="panel-title">月別の推移</h3>
          <p className="panel-caption">送信数と、その月に初めて連絡したリードの反応です（不達は除く）。</p>
        </div>
        <div className="btn-row">
          <div className="segmented" role="group" aria-label="期間">
            {([6, 12] as const).map((value) => (
              <button key={value} type="button" className={period === value ? "segment active" : "segment"} aria-pressed={period === value} onClick={() => setPeriod(value)}>
                直近{value}か月
              </button>
            ))}
          </div>
          <button type="button" className="btn secondary" aria-pressed={showTable} onClick={() => setShowTable((current) => !current)}>
            {showTable ? "グラフで見る" : "表で見る"}
          </button>
        </div>
      </div>

      {error && <p className="error-box">{error}</p>}
      {!rows && !error && <p className="panel-caption">読み込み中...</p>}

      {rows && !showTable && (
        <div className="viz-grid-wrap">
          <ColumnChart
            title="月別の送信数"
            description="メールとフォームの送信件数"
            months={months}
            unit="件"
            series={[
              { key: "email", label: "メール", color: "var(--viz-1)", values: visible.map((row) => row.email) },
              { key: "form", label: "フォーム", color: "var(--viz-2)", values: visible.map((row) => row.form) }
            ]}
          />
          <ColumnChart
            title="月別の反応数"
            description="その月に初めて連絡したリードのうち、反応があった数"
            months={months}
            unit="件"
            series={[{ key: "reactions", label: "反応あり", color: "var(--viz-3)", values: visible.map((row) => row.reactions) }]}
          />
          <LineChart
            title="月別の反応率"
            description="反応数 ÷ 初めて連絡したリード数"
            months={months}
            color="var(--viz-3)"
            values={visible.map((row) => percent(row.reactions, row.contacted))}
            detail={(index) => `反応 ${visible[index].reactions}件 / 連絡 ${visible[index].contacted}件`}
          />
        </div>
      )}

      {rows && showTable && (
        <div className="data-table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>月</th>
                <th>メール送信</th>
                <th>フォーム送信</th>
                <th>不達</th>
                <th>初めて連絡したリード</th>
                <th>反応あり</th>
                <th>反応率</th>
              </tr>
            </thead>
            <tbody>
              {[...visible].reverse().map((row) => (
                <tr key={row.month}>
                  <td className="cell-nowrap">{row.month}</td>
                  <td>{row.email}</td>
                  <td>{row.form}</td>
                  <td>{row.bounced}</td>
                  <td>{row.contacted}</td>
                  <td>{row.reactions}</td>
                  <td>{percent(row.reactions, row.contacted)}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
