-- DevSpace schema migration 005: durable write idempotency
-- Apply inside the same SQLite migration transaction as the other local-state tables.

create table if not exists write_idempotency (
  scope_key text not null,
  idempotency_key text not null,
  payload_hash text not null,
  state text not null check (state in ('pending', 'succeeded', 'failed')),
  lease_token text,
  result_json text,
  error_code text,
  error_message text,
  created_at text not null,
  updated_at text not null,
  pending_until text,
  retained_until text not null,
  primary key (scope_key, idempotency_key)
);

create index if not exists write_idempotency_state_retained_idx
  on write_idempotency(state, retained_until);

create index if not exists write_idempotency_pending_idx
  on write_idempotency(state, pending_until);
