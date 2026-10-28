"use client";

// NOTE on storage: the queue is kept in this browser's localStorage only.
// It is NOT shared between people or devices. To share one queue across the
// syndicate, replace loadBets/saveBets with calls to a shared database
// (e.g. Vercel Postgres or Supabase) via API routes under app/api/. See README.md.

import { useEffect, useMemo, useState } from "react";
import {
  type Bet,
  type BetStatus,
  NEXT_ACTIONS,
  STATUSES,
  STATUS_LABEL,
  STORAGE_KEY,
  betSummary,
  formatMoney,
  isValidBetInput,
  newId,
  potentialReturn,
} from "@/lib/bets";

const BET365_URL = "https://www.bet365.com";

function loadBets(): Bet[] {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as Bet[]) : [];
  } catch {
    // Storage may be unavailable (private mode, blocked cookies) or the JSON may be corrupt.
    return [];
  }
}

function saveBets(bets: Bet[]) {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(bets));
  } catch {
    // Ignore: the queue still works for this page session.
  }
}

const emptyForm = { event: "", market: "", selection: "", odds: "", stake: "", notes: "", proposedBy: "" };

const STATUS_STYLE: Record<BetStatus, string> = {
  proposed: "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200",
  approved: "bg-sky-100 text-sky-800 dark:bg-sky-900/40 dark:text-sky-200",
  placed: "bg-violet-100 text-violet-800 dark:bg-violet-900/40 dark:text-violet-200",
  settled_won: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200",
  settled_lost: "bg-rose-100 text-rose-800 dark:bg-rose-900/40 dark:text-rose-200",
  settled_void: "bg-slate-200 text-slate-700 dark:bg-slate-700 dark:text-slate-200",
};

export default function BetQueue() {
  const [bets, setBets] = useState<Bet[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [formError, setFormError] = useState<string | null>(null);
  const [filter, setFilter] = useState<BetStatus | "all">("all");
  const [placingId, setPlacingId] = useState<string | null>(null);
  const [placeForm, setPlaceForm] = useState({ odds: "", stake: "" });
  const [notice, setNotice] = useState<string | null>(null);

  // Load after mount so server and client render the same HTML.
  useEffect(() => {
    // Reading localStorage must happen after mount (it is not available on the server).
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setBets(loadBets());
    setLoaded(true);
  }, []);

  useEffect(() => {
    if (loaded) saveBets(bets);
  }, [bets, loaded]);

  const counts = useMemo(() => {
    const c: Record<string, number> = { all: bets.length };
    for (const s of STATUSES) c[s] = bets.filter((b) => b.status === s).length;
    return c;
  }, [bets]);

  const visible = useMemo(
    () =>
      bets
        .filter((b) => filter === "all" || b.status === filter)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    [bets, filter],
  );

  function update(id: string, patch: Partial<Bet>) {
    setBets((prev) => prev.map((b) => (b.id === id ? { ...b, ...patch } : b)));
  }

  function submitProposal(e: React.FormEvent) {
    e.preventDefault();
    const odds = Number(form.odds);
    const stake = Number(form.stake);
    const err = isValidBetInput({ event: form.event, selection: form.selection, odds, stake });
    if (err) {
      setFormError(err);
      return;
    }
    const bet: Bet = {
      id: newId(),
      event: form.event.trim(),
      market: form.market.trim(),
      selection: form.selection.trim(),
      odds,
      stake,
      notes: form.notes.trim(),
      proposedBy: form.proposedBy.trim(),
      createdAt: new Date().toISOString(),
      status: "proposed",
    };
    setBets((prev) => [bet, ...prev]);
    setForm(emptyForm);
    setFormError(null);
  }

  function startPlacing(bet: Bet) {
    setPlacingId(bet.id);
    setPlaceForm({ odds: String(bet.odds), stake: String(bet.stake) });
  }

  function confirmPlaced(bet: Bet) {
    const odds = Number(placeForm.odds);
    const stake = Number(placeForm.stake);
    if (!Number.isFinite(odds) || odds <= 1 || !Number.isFinite(stake) || stake <= 0) {
      setNotice("Enter the actual odds (greater than 1.00) and stake you placed.");
      return;
    }
    update(bet.id, { status: "placed", placedOdds: odds, placedStake: stake, placedAt: new Date().toISOString() });
    setPlacingId(null);
    setNotice(null);
  }

  function remove(bet: Bet) {
    if (window.confirm(`Delete "${bet.selection}" on ${bet.event}?`)) {
      setBets((prev) => prev.filter((b) => b.id !== bet.id));
    }
  }

  async function copyDetails(bet: Bet) {
    try {
      await navigator.clipboard.writeText(betSummary(bet));
      setNotice("Bet details copied to clipboard.");
    } catch {
      setNotice("Could not access the clipboard. Copy the details manually.");
    }
  }

  const inputClass =
    "w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-800";

  return (
    <div className="space-y-8">
      {/* Proposal form (members) */}
      <section className="rounded-lg border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-900">
        <h2 className="mb-3 text-lg font-medium text-slate-900 dark:text-white">Propose a bet</h2>
        <form onSubmit={submitProposal} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <label className="space-y-1 text-sm lg:col-span-2">
            <span className="text-slate-600 dark:text-slate-300">Event *</span>
            <input className={inputClass} value={form.event} onChange={(e) => setForm({ ...form, event: e.target.value })} placeholder="e.g. Arsenal v Spurs, Sat 15:00" />
          </label>
          <label className="space-y-1 text-sm">
            <span className="text-slate-600 dark:text-slate-300">Market</span>
            <input className={inputClass} value={form.market} onChange={(e) => setForm({ ...form, market: e.target.value })} placeholder="e.g. Match result" />
          </label>
          <label className="space-y-1 text-sm">
            <span className="text-slate-600 dark:text-slate-300">Selection *</span>
            <input className={inputClass} value={form.selection} onChange={(e) => setForm({ ...form, selection: e.target.value })} placeholder="e.g. Arsenal to win" />
          </label>
          <label className="space-y-1 text-sm">
            <span className="text-slate-600 dark:text-slate-300">Odds (decimal) *</span>
            <input className={inputClass} inputMode="decimal" value={form.odds} onChange={(e) => setForm({ ...form, odds: e.target.value })} placeholder="2.50" />
          </label>
          <label className="space-y-1 text-sm">
            <span className="text-slate-600 dark:text-slate-300">Stake (GBP) *</span>
            <input className={inputClass} inputMode="decimal" value={form.stake} onChange={(e) => setForm({ ...form, stake: e.target.value })} placeholder="10" />
          </label>
          <label className="space-y-1 text-sm">
            <span className="text-slate-600 dark:text-slate-300">Proposed by</span>
            <input className={inputClass} value={form.proposedBy} onChange={(e) => setForm({ ...form, proposedBy: e.target.value })} placeholder="Your name" />
          </label>
          <label className="space-y-1 text-sm sm:col-span-2 lg:col-span-3">
            <span className="text-slate-600 dark:text-slate-300">Notes</span>
            <textarea className={inputClass} rows={2} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
          </label>
          <div className="flex items-center gap-3 sm:col-span-2 lg:col-span-3">
            <button type="submit" className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700 dark:bg-white dark:text-slate-900 dark:hover:bg-slate-200">
              Add to queue
            </button>
            {formError && <p role="alert" className="text-sm text-rose-600 dark:text-rose-400">{formError}</p>}
          </div>
        </form>
      </section>

      {/* Queue (leader) */}
      <section className="space-y-4">
        <div className="flex flex-wrap gap-2" role="tablist" aria-label="Filter by status">
          {(["all", ...STATUSES] as const).map((s) => (
            <button
              key={s}
              type="button"
              role="tab"
              aria-selected={filter === s}
              onClick={() => setFilter(s)}
              className={`rounded-full px-3 py-1 text-sm ${
                filter === s
                  ? "bg-slate-900 text-white dark:bg-white dark:text-slate-900"
                  : "bg-slate-200 text-slate-700 hover:bg-slate-300 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
              }`}
            >
              {s === "all" ? "All" : STATUS_LABEL[s]} ({counts[s] ?? 0})
            </button>
          ))}
        </div>

        {notice && (
          <p role="status" className="text-sm text-slate-600 dark:text-slate-300">
            {notice}
          </p>
        )}

        {loaded && visible.length === 0 && (
          <p className="rounded-lg border border-dashed border-slate-300 p-6 text-center text-sm text-slate-500 dark:border-slate-700">
            No bets here yet.
          </p>
        )}

        <ul className="grid gap-4 lg:grid-cols-2">
          {visible.map((bet) => (
            <li key={bet.id} className="space-y-3 rounded-lg border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-900">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <p className="font-medium text-slate-900 dark:text-white">{bet.selection}</p>
                  <p className="text-sm text-slate-600 dark:text-slate-300">
                    {bet.event}
                    {bet.market ? ` · ${bet.market}` : ""}
                  </p>
                </div>
                <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${STATUS_STYLE[bet.status]}`}>
                  {STATUS_LABEL[bet.status]}
                </span>
              </div>

              <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm sm:grid-cols-4">
                <div>
                  <dt className="text-slate-500 dark:text-slate-400">Odds</dt>
                  <dd>{bet.odds.toFixed(2)}</dd>
                </div>
                <div>
                  <dt className="text-slate-500 dark:text-slate-400">Stake</dt>
                  <dd>{formatMoney(bet.stake)}</dd>
                </div>
                <div>
                  <dt className="text-slate-500 dark:text-slate-400">Potential return</dt>
                  <dd>{formatMoney(potentialReturn(bet.stake, bet.odds))}</dd>
                </div>
                <div>
                  <dt className="text-slate-500 dark:text-slate-400">Proposed by</dt>
                  <dd>{bet.proposedBy || "-"}</dd>
                </div>
                {bet.placedOdds !== undefined && (
                  <div>
                    <dt className="text-slate-500 dark:text-slate-400">Placed at</dt>
                    <dd>
                      {bet.placedOdds.toFixed(2)} / {formatMoney(bet.placedStake)}
                    </dd>
                  </div>
                )}
              </dl>

              {bet.notes && <p className="text-sm text-slate-600 dark:text-slate-300">{bet.notes}</p>}

              {placingId === bet.id && (
                <div className="grid grid-cols-2 gap-2 rounded-md bg-slate-50 p-3 dark:bg-slate-800">
                  <label className="space-y-1 text-sm">
                    <span className="text-slate-600 dark:text-slate-300">Actual odds</span>
                    <input className={inputClass} inputMode="decimal" value={placeForm.odds} onChange={(e) => setPlaceForm({ ...placeForm, odds: e.target.value })} />
                  </label>
                  <label className="space-y-1 text-sm">
                    <span className="text-slate-600 dark:text-slate-300">Actual stake (GBP)</span>
                    <input className={inputClass} inputMode="decimal" value={placeForm.stake} onChange={(e) => setPlaceForm({ ...placeForm, stake: e.target.value })} />
                  </label>
                  <div className="col-span-2 flex gap-2">
                    <button type="button" onClick={() => confirmPlaced(bet)} className="rounded-md bg-violet-600 px-3 py-1.5 text-sm text-white hover:bg-violet-500">
                      Save as placed
                    </button>
                    <button type="button" onClick={() => setPlacingId(null)} className="rounded-md px-3 py-1.5 text-sm text-slate-600 hover:underline dark:text-slate-300">
                      Cancel
                    </button>
                  </div>
                </div>
              )}

              <div className="flex flex-wrap gap-2 text-sm">
                {NEXT_ACTIONS[bet.status].includes("approve") && (
                  <ActionButton onClick={() => update(bet.id, { status: "approved" })}>Approve</ActionButton>
                )}
                {NEXT_ACTIONS[bet.status].includes("place") && (
                  <ActionButton onClick={() => startPlacing(bet)}>Mark as placed</ActionButton>
                )}
                {NEXT_ACTIONS[bet.status].includes("settle_won") && (
                  <ActionButton onClick={() => update(bet.id, { status: "settled_won", settledAt: new Date().toISOString() })}>Won</ActionButton>
                )}
                {NEXT_ACTIONS[bet.status].includes("settle_lost") && (
                  <ActionButton onClick={() => update(bet.id, { status: "settled_lost", settledAt: new Date().toISOString() })}>Lost</ActionButton>
                )}
                {NEXT_ACTIONS[bet.status].includes("settle_void") && (
                  <ActionButton onClick={() => update(bet.id, { status: "settled_void", settledAt: new Date().toISOString() })}>Void</ActionButton>
                )}
              </div>

              <div className="flex flex-wrap items-center gap-2 border-t border-slate-100 pt-3 text-sm dark:border-slate-800">
                <a
                  href={BET365_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="rounded-md bg-emerald-600 px-3 py-1.5 font-medium text-white hover:bg-emerald-500"
                >
                  Open bet365
                </a>
                <button type="button" onClick={() => copyDetails(bet)} className="rounded-md border border-slate-300 px-3 py-1.5 hover:bg-slate-100 dark:border-slate-600 dark:hover:bg-slate-800">
                  Copy bet details
                </button>
                <button type="button" onClick={() => remove(bet)} className="ml-auto text-rose-600 hover:underline dark:text-rose-400">
                  Delete
                </button>
              </div>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

function ActionButton({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" onClick={onClick} className="rounded-md bg-slate-900 px-3 py-1.5 font-medium text-white hover:bg-slate-700 dark:bg-white dark:text-slate-900 dark:hover:bg-slate-200">
      {children}
    </button>
  );
}
