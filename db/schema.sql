create table if not exists bets (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  proposed_by text not null,
  event text not null,
  market text,
  selection text not null,
  odds numeric(10,2),
  stake numeric(12,2),
  notes text,
  status text not null default 'proposed'
    check (status in ('proposed','approved','placed','won','lost','void','rejected')),
  placed_odds numeric(10,2),
  placed_stake numeric(12,2),
  placed_at timestamptz,
  returns numeric(12,2),
  settled_at timestamptz
);
create index if not exists bets_status_idx on bets(status);
create index if not exists bets_created_at_idx on bets(created_at desc);
