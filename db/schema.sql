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

-- Weekly payments are automatic (standing orders). Only exceptions are stored: a member-week with no row is paid.
-- A row with paid = false is a missed payment; a row with paid = true records a re-tick.
create table if not exists payments (
  id uuid primary key default gen_random_uuid(),
  member text not null,
  week_number integer not null check (week_number >= 1),
  paid boolean not null,
  note text,
  updated_at timestamptz not null default now(),
  unique (member, week_number)
);

-- Results of bets not placed through the queue (returns include the stake; 0 for a loss).
create table if not exists results (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  result_date date not null,
  member text not null,
  description text,
  stake numeric(12,2) not null check (stake >= 0),
  returns numeric(12,2) not null check (returns >= 0),
  notes text
);
create index if not exists results_date_idx on results(result_date);

-- Fines. paid_at is set when the fine is marked as paid and cleared when it is marked unpaid again.
create table if not exists fines (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  member text not null,
  amount numeric(12,2) not null check (amount >= 0),
  reason text,
  fine_date date not null,
  paid_at timestamptz
);
create index if not exists fines_fine_date_idx on fines(fine_date);
