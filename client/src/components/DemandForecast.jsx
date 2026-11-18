import { useState, useEffect, useCallback } from "react";
import api from "../api";
import Loading from "./Loading";
import { formatUnits } from "./units";
import "./fulfillment.css";

// Predictive analytics: blood demand and supply forecast.
// All numbers come from GET /analytics/forecast (server/bloodlink.py):
//   demand = units asked for in blood requests, supply = units from completed donations
//   forecast k weeks ahead = average of the last 4 weeks (+ trend x k, if that tested better)
//   MAE = average |forecast - actual| in units, MAPE = the same in % of the actual

const gtxt = (g) => String(g || "").replace("-", "−");
const RED = "#7a1018";
const PINK = "#c9525f";
const GREEN = "#2f8a5b";
const GRID = "#e6e9ed";
const MUTED = "#75808f";

const STATUS = {
  short_now: { cls: "crit", label: "Not enough for next week" },
  shortage: { cls: "crit", label: "Runs out within 4 weeks" },
  below_min: { cls: "warn", label: "Below minimum" },
  enough: { cls: "ok", label: "Enough" },
  no_demand: { cls: "", label: "No recent requests" },
};
const ORDER = { short_now: 0, shortage: 1, below_min: 2, enough: 3, no_demand: 4 };
const isShort = (g) => g.status === "short_now" || g.status === "shortage";

const ACTION = (g) => {
  if (isShort(g)) {
    return g.blood_type.endsWith("-")
      ? `Contact ${gtxt(g.blood_type)} donors now (rare type)`
      : `Need about ${formatUnits(Math.ceil(g.shortfall))} more unit(s): schedule a blood drive`;
  }
  if (g.status === "below_min") return `Top up about ${formatUnits(Math.ceil(g.shortfall))} unit(s) to reach the minimum`;
  return "No action needed";
};

const shortDate = (iso) =>
  new Date(`${iso}T00:00:00`).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
const niceMax = (v) => Math.max(4, Math.ceil(v / 4) * 4);
const pathOf = (pts, x, y) =>
  pts.filter(([, v]) => v !== null && v !== undefined)
    .map(([i, v], k) => `${k ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ");

function Legend({ items }) {
  return (
    <div className="ft-legend">
      {items.map(([color, label, dashed]) => (
        <span key={label}>
          <i style={dashed ? { background: "none", borderTop: `2px dashed ${color}`, height: 0, width: 14 } : { background: color }} />
          {label}
        </span>
      ))}
    </div>
  );
}

// ---------- weekly chart: requests and donations, past + forecast ----------
function WeeklyChart({ labels, demand, demandFc, low, high, supply, supplyFc }) {
  const W = 1100, H = 300, L = 40, R = 30, T = 14, B = 30;
  const n = labels.length, nh = demand.length;
  const yMax = niceMax(Math.max(...demand, ...high, ...supply, ...supplyFc));
  const x = (i) => L + (i * (W - L - R)) / Math.max(1, n - 1);
  const y = (v) => T + (H - T - B) * (1 - v / yMax);
  const ticks = [0, 1, 2, 3, 4].map((k) => (yMax * k) / 4);
  const join = (hist, fc) => [[nh - 1, hist[nh - 1]], ...fc.map((v, k) => [nh + k, v])];
  const band =
    join(demand, high).map(([i, v], k) => `${k ? "L" : "M"}${x(i)},${y(v)}`).join(" ") + " " +
    [...low.map((v, k) => [nh + k, v]).reverse(), [nh - 1, demand[nh - 1]]].map(([i, v]) => `L${x(i)},${y(v)}`).join(" ") + " Z";

  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img"
      aria-label={`Weekly units requested and donated for the last ${nh} weeks, with a forecast for the next ${demandFc.length} weeks`}>
      {ticks.map((t) => (
        <g key={t}>
          <line x1={L} x2={W - R} y1={y(t)} y2={y(t)} stroke={GRID} />
          <text x={L - 6} y={y(t) + 4} textAnchor="end" fontSize="11" fill={MUTED}>{formatUnits(Math.round(t * 2) / 2)}</text>
        </g>
      ))}
      <rect x={x(nh - 0.5)} y={T} width={x(n - 1) - x(nh - 0.5) + 6} height={H - T - B} fill="#f7f8fa" />
      <text x={x(nh - 0.5) + 6} y={T + 12} fontSize="11" fill={MUTED}>Forecast</text>
      <path d={band} fill="rgba(201,82,95,0.15)" />
      <path d={pathOf(supply.map((v, i) => [i, v]), x, y)} fill="none" stroke={GREEN} strokeWidth="2" />
      <path d={pathOf(join(supply, supplyFc), x, y)} fill="none" stroke={GREEN} strokeWidth="2" strokeDasharray="6 4" />
      <path d={pathOf(demand.map((v, i) => [i, v]), x, y)} fill="none" stroke={RED} strokeWidth="2.2" strokeLinejoin="round" />
      <path d={pathOf(join(demand, demandFc), x, y)} fill="none" stroke={PINK} strokeWidth="2.2" strokeDasharray="6 4" />
      {demand.map((v, i) => (
        <circle key={`d${i}`} cx={x(i)} cy={y(v)} r="3" fill={RED}>
          <title>{`${shortDate(labels[i])}: ${formatUnits(v)} requested, ${formatUnits(supply[i])} donated`}</title>
        </circle>
      ))}
      {demandFc.map((v, k) => (
        <rect key={`f${k}`} x={x(nh + k) - 3.5} y={y(v) - 3.5} width="7" height="7" fill={PINK} transform={`rotate(45 ${x(nh + k)} ${y(v)})`}>
          <title>{`${shortDate(labels[nh + k])}: about ${formatUnits(v)} requested (likely ${formatUnits(low[k])}–${formatUnits(high[k])}), about ${formatUnits(supplyFc[k])} donated`}</title>
        </rect>
      ))}
      {labels.map((d, i) => (i % 2 === 0 || i >= nh) && (
        <text key={d} x={x(i)} y={H - 10} textAnchor="middle" fontSize="11" fill={i >= nh ? PINK : MUTED}>{shortDate(d)}</text>
      ))}
    </svg>
  );
}

// ---------- supply vs demand, next 4 weeks, one pair of bars per group ----------
function SupplyDemandBars({ groups }) {
  const W = 1100, H = 240, L = 40, R = 10, T = 14, B = 30;
  const yMax = niceMax(Math.max(...groups.map((g) => Math.max(g.next4w, g.supply_next4w))));
  const step = (W - L - R) / groups.length;
  const bw = Math.min(26, step / 3);
  const y = (v) => T + (H - T - B) * (1 - v / yMax);
  const ticks = [0, 1, 2, 3, 4].map((k) => (yMax * k) / 4);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img"
      aria-label="Expected units requested and donated in the next 4 weeks for each blood group">
      {ticks.map((t) => (
        <g key={t}>
          <line x1={L} x2={W - R} y1={y(t)} y2={y(t)} stroke={GRID} />
          <text x={L - 6} y={y(t) + 4} textAnchor="end" fontSize="11" fill={MUTED}>{formatUnits(Math.round(t * 2) / 2)}</text>
        </g>
      ))}
      {groups.map((g, i) => {
        const cx = L + step * i + step / 2;
        const gap = g.next4w - g.supply_next4w;
        return (
          <g key={g.blood_type}>
            <rect x={cx - bw - 1} y={y(g.next4w)} width={bw} height={y(0) - y(g.next4w)} fill={RED} rx="2">
              <title>{`${gtxt(g.blood_type)}: about ${formatUnits(g.next4w)} unit(s) requested`}</title>
            </rect>
            <rect x={cx + 1} y={y(g.supply_next4w)} width={bw} height={y(0) - y(g.supply_next4w)} fill={GREEN} rx="2">
              <title>{`${gtxt(g.blood_type)}: about ${formatUnits(g.supply_next4w)} unit(s) donated`}</title>
            </rect>
            <text x={cx} y={H - 10} textAnchor="middle" fontSize="12" fontWeight={gap > 0.5 ? 700 : 400} fill={gap > 0.5 ? "#b01f2e" : MUTED}>
              {gtxt(g.blood_type)}{gap > 0.5 ? ` (−${formatUnits(Math.round(gap * 2) / 2)})` : ""}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

export default function DemandForecast({ bloodBankId = null }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [pick, setPick] = useState("all");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const q = bloodBankId ? `?blood_bank_id=${bloodBankId}` : "";
      const res = await api.get(`/analytics/forecast${q}`);
      setData(res.data);
    } catch (e) {
      setError(e.response?.data?.message || (e.response
        ? `Could not load the forecast (HTTP ${e.response.status}). Restart the Flask server so the new route is loaded.`
        : "Cannot reach the Flask server."));
    } finally {
      setLoading(false);
    }
  }, [bloodBankId]);

  useEffect(() => { load(); }, [load]);

  if (loading && !data) return <div className="panel"><div className="empty"><Loading label="Calculating forecast..." /></div></div>;
  if (error && !data) return <div className="panel"><div className="empty">{error}</div></div>;
  if (!data) return null;

  const m = data.method;
  const acc = data.accuracy;
  const isBank = data.scope === "bank";
  const groups = [...data.groups].sort((a, b) => ORDER[a.status] - ORDER[b.status] || a.projected - b.projected);
  const short = groups.filter(isShort);
  const belowMin = groups.filter((g) => g.status === "below_min");
  const sel = pick === "all" ? null : data.groups.find((g) => g.blood_type === pick);
  const series = sel || data.total;
  const labels = [...data.week_labels, ...data.forecast_labels];
  const change = data.total.last4w ? Math.round(((data.total.next4w - data.total.last4w) / data.total.last4w) * 100) : null;

  return (
    <div>
      {error && <div className="msg err">{error}</div>}

      {/* 1. SUMMARY */}
      <div className="ft-kpis">
        <div className="ft-kpi" style={short.length ? { borderColor: "#e9b4b9" } : undefined}>
          <div className="k">Expected shortage, next {m.horizon_weeks} weeks</div>
          <div className="v" style={{ color: short.length ? "#b01f2e" : GREEN }}>{short.length ? `${short.length} group${short.length > 1 ? "s" : ""}` : "None"}</div>
          <div className="k">{short.length ? short.map((g) => gtxt(g.blood_type)).join(", ") : "requests are covered"}</div>
        </div>
        <div className="ft-kpi" style={belowMin.length ? { borderColor: "#f0d9a8" } : undefined}>
          <div className="k">Below minimum</div>
          <div className="v" style={{ color: belowMin.length ? "#b87a0a" : GREEN }}>{belowMin.length ? `${belowMin.length} group${belowMin.length > 1 ? "s" : ""}` : "None"}</div>
          <div className="k">{belowMin.length ? belowMin.map((g) => gtxt(g.blood_type)).join(", ") : "all at or above minimum"}</div>
        </div>
        <div className="ft-kpi">
          <div className="k">Units requested, next {m.horizon_weeks} weeks</div>
          <div className="v">{formatUnits(Math.round(data.total.next4w))}</div>
          <div className="k">{change === null ? "no requests in the last 4 weeks" : `${change >= 0 ? "up" : "down"} ${Math.abs(change)}% vs last ${m.horizon_weeks} weeks`}</div>
        </div>
        <div className="ft-kpi">
          <div className="k">Forecast accuracy (MAE)</div>
          <div className="v">±{formatUnits(Math.round(acc.mae * 10) / 10)}</div>
          <div className="k">units per week{acc.mape !== null ? ` · MAPE ${acc.mape}%` : ""}</div>
        </div>
      </div>

      {/* 2. WEEKLY CHART */}
      <div className="panel">
        <div className="panel-h">
          <h3>Weekly units requested and donated{sel ? ` · ${gtxt(sel.blood_type)}` : " · all blood groups"}
            <span className="sub">Last {m.history_weeks} weeks and the next {m.horizon_weeks}</span>
          </h3>
          <button type="button" className="link" onClick={load}>Refresh</button>
        </div>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", padding: "0 14px 6px" }}>
          {["all", ...data.groups.map((g) => g.blood_type)].map((g) => (
            <button key={g} type="button" className={`btn sm ${pick === g ? "pri" : ""}`} onClick={() => setPick(g)}>
              {g === "all" ? "All" : gtxt(g)}
            </button>
          ))}
        </div>
        <Legend items={[[RED, "Requested"], [PINK, "Requested (forecast)", true], ["rgba(201,82,95,0.3)", "Likely range"], [GREEN, "Donated"], [GREEN, "Donated (forecast)", true]]} />
        <div style={{ padding: "0 10px 6px" }}>
          <WeeklyChart labels={labels} demand={series.history} demandFc={series.forecast} low={series.low} high={series.high}
            supply={series.supply_history} supplyFc={series.supply_forecast} />
        </div>
      </div>

      {/* 3. SUPPLY VS DEMAND */}
      <div className="panel">
        <div className="panel-h">
          <h3>Supply vs demand, next {m.horizon_weeks} weeks
            <span className="sub">{isBank ? "Donations to your bank vs requests across BloodLink" : "Donations to verified banks vs all requests"}</span>
          </h3>
        </div>
        <Legend items={[[RED, "Expected requests"], [GREEN, "Expected donations"]]} />
        <div style={{ padding: "0 10px 6px" }}>
          <SupplyDemandBars groups={data.groups} />
        </div>
        <div className="foot-note" style={{ padding: "0 14px 10px", fontSize: 12, color: MUTED }}>
          Groups in red have more requests than donations expected; the number is the gap in units.
        </div>
      </div>

      {/* 4. TABLE BY GROUP */}
      <div className="panel">
        <div className="panel-h">
          <h3>Forecast by blood group<span className="sub">{isBank ? data.scope_name : "All verified blood banks combined"}</span></h3>
        </div>
        <div className="tw">
          <table>
            <thead>
              <tr>
                <th>Group</th><th className="r">On hand</th><th className="r">Minimum</th>
                <th className="r">Requested ({m.horizon_weeks} wk)</th><th className="r">Donated ({m.horizon_weeks} wk)</th>
                <th className="r">Stock after {m.horizon_weeks} wk</th><th className="r">Days left</th><th>Status</th><th>Suggested action</th>
              </tr>
            </thead>
            <tbody>
              {groups.map((g) => (
                <tr key={g.blood_type} className={`ft-row ${pick === g.blood_type ? "sel" : ""}`} onClick={() => setPick(g.blood_type)}>
                  <td><b className="grp">{gtxt(g.blood_type)}</b></td>
                  <td className="r num"><b>{formatUnits(g.on_hand)}</b></td>
                  <td className="r num">{formatUnits(g.min_units)}</td>
                  <td className="r num">{formatUnits(g.next4w)}</td>
                  <td className="r num">{formatUnits(g.supply_next4w)}</td>
                  <td className="r num" style={{ color: g.projected < 0 ? "#b01f2e" : g.projected < g.min_units ? "#b87a0a" : undefined }}>
                    <b>{g.projected < 0 ? `−${formatUnits(Math.abs(g.projected))}` : formatUnits(g.projected)}</b>
                  </td>
                  <td className="r num">{g.days_left === null ? "—" : g.days_left}</td>
                  <td><span className={`st ${STATUS[g.status].cls}`}>{STATUS[g.status].label}</span></td>
                  <td className="wrap">{ACTION(g)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div style={{ padding: "8px 14px 12px", fontSize: 12, color: MUTED }}>
          {isBank
            ? "Requests are counted across all of BloodLink, so the numbers show how your stock would hold up if your bank covered every request. "
            : ""}
          Cancelled requests are not counted. Decision support only: it does not replace blood bank procedures or medical decisions.
        </div>
      </div>

    </div>
  );
}