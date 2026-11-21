-- =====================================================================
-- BAZAARBRIDGE AUTHORITATIVE DATABASE SCHEMA (schema.sql)
-- Version: 7.2 (Corrected & Frozen)
-- =====================================================================

-- =====================================================================
-- PART 1: CORE COMMERCE
-- =====================================================================

create table users (
  user_id uuid primary key default gen_random_uuid(),
  name text not null,
  email text unique not null,
  password_hash text not null,
  role text not null default 'customer'
  check (role in ('customer','admin','rider'))
);

create table categories (
  category_id uuid primary key default gen_random_uuid(),
  category_name text not null unique
);

create table products (
  product_id uuid primary key default gen_random_uuid(),
  name text not null,
  description text,
  brand text,
  category_id uuid not null references categories,
  specs jsonb not null default '{}'
);

create table dealers (
  dealer_id uuid primary key default gen_random_uuid(),
  shop_name text not null,
  city text not null,
  state text not null,
  contact text,
  dealer_rating numeric(2,1) not null default 0 check (dealer_rating between 0 and 5),
  total_reviews int not null default 0,
  verified boolean not null default false,
  supplier_status text not null default 'active'
);

create table dealer_offers (
  offer_id uuid primary key default gen_random_uuid(),
  product_id uuid not null references products,
  dealer_id uuid not null references dealers,
  purchase_price bigint not null check (purchase_price >= 0),
  selling_price bigint not null check (selling_price > 0),
  status text not null default 'active',
  bangalore_delivery_days int,
  transfer_days_min int,
  transfer_days_max int,
  eligible_modes text[] not null default '{standard}',
  warranty_months int not null default 0,
  warranty_note text
);

create table stock_locations (
  location_id uuid primary key default gen_random_uuid(),
  name text not null,
  city text not null,
  state text not null,
  location_type text not null
  check (location_type in ('warehouse','hub','holding','quarantine')),
  is_home boolean not null default false,
  is_sellable boolean not null default true
);

create table inventory (
  inventory_id uuid primary key default gen_random_uuid(),
  offer_id uuid not null references dealer_offers,
  location_id uuid not null references stock_locations,
  quantity int not null check (quantity >= 0),
  reserved_quantity int not null default 0,
  unique (offer_id, location_id), -- REQUIRED by the restock_units upsert
  check (reserved_quantity between 0 and quantity)
);

create table reservations (
  reservation_id uuid primary key default gen_random_uuid(),
  offer_id uuid not null references dealer_offers,
  location_id uuid not null references stock_locations,
  user_id uuid not null references users,
  quantity int not null check (quantity > 0),
  price_paise bigint not null check (price_paise > 0), -- authoritative price
  status text not null default 'reserved'
  check (status in ('reserved','confirmed','expired','released')),
  expires_at timestamptz not null,
  request_key text not null,
  unique (user_id, request_key)
);

create table carts (
  cart_id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references users
);

create table cart_items (
  cart_item_id uuid primary key default gen_random_uuid(),
  cart_id uuid not null references carts,
  offer_id uuid not null references dealer_offers,
  quantity int not null check (quantity > 0),
  price_snapshot bigint not null, -- DISPLAY ONLY
  reservation_id uuid references reservations, -- DELETE releases the hold
  saved_for_later boolean not null default false
);

create table orders (
  order_id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users,
  items_total bigint not null,
  discount_total bigint not null default 0,
  delivery_fee_total bigint not null default 0,
  total_amount bigint not null,
  coupon_code text,
  delivery_pin_code text,
  status text not null default 'placed',
  placed_at timestamptz not null default now()
);

create table order_items (
  order_item_id uuid primary key default gen_random_uuid(),
  order_id uuid not null references orders,
  group_id uuid,
  reservation_id uuid not null unique references reservations,
  offer_id uuid not null references dealer_offers,
  dealer_id uuid not null references dealers,
  quantity int not null,
  line_price bigint not null,
  discount_share bigint not null default 0,
  delivery_fee_share bigint not null default 0,
  item_paid_amount bigint generated always as (line_price - discount_share) stored,
  paid_amount bigint generated always as (line_price - discount_share + delivery_fee_share) stored,
  item_refunded_amount bigint not null default 0,
  fee_refunded_amount bigint not null default 0,
  refunded_amount bigint generated always as (item_refunded_amount + fee_refunded_amount) stored,
  stock_location_id uuid not null references stock_locations,
  fulfilment_route text,
  stock_finalised boolean not null default false,
  promised_delivery_start timestamptz,
  promised_delivery_end timestamptz,
  delivered_at timestamptz,
  item_status text not null default 'placed'
  check (item_status in ('placed','confirmed','cancelled','delivered')),
  cancelled_at timestamptz,
  check (discount_share between 0 and line_price),
  check (delivery_fee_share >= 0),
  check (item_refunded_amount between 0 and line_price - discount_share),
  check (fee_refunded_amount between 0 and delivery_fee_share)
);

create table offer_price_history (
  history_id bigserial primary key,
  offer_id uuid not null references dealer_offers,
  selling_price bigint not null check (selling_price > 0),
  valid_from timestamptz not null,
  valid_to timestamptz,
  check (valid_to is null or valid_to > valid_from)
);

create unique index one_open_price_per_offer
  on offer_price_history (offer_id) where valid_to is null;

-- v7.2: price history trigger (clock_timestamp avoids valid_to = valid_from
-- when two price changes happen in one transaction, e.g. the seed).
create or replace function log_offer_price() returns trigger
language plpgsql as $$
begin
  if tg_op = 'INSERT' or new.selling_price is distinct from old.selling_price then
    update offer_price_history set valid_to = clock_timestamp()
    where offer_id = new.offer_id and valid_to is null;
    insert into offer_price_history (offer_id, selling_price, valid_from)
    values (new.offer_id, new.selling_price, clock_timestamp());
  end if;
  return new;
end $$;

create trigger trg_log_price after insert or update of selling_price
  on dealer_offers for each row execute function log_offer_price();


-- =====================================================================
-- PART 2: EVENTS AND ORDERING
-- =====================================================================

create table outbox_events (
  event_id uuid primary key default gen_random_uuid(),
  event_type text not null,
  aggregate_key text not null, -- Kafka message key
  payload jsonb not null,
  created_at timestamptz not null default now(),
  published_at timestamptz
);

create table processed_events (
  event_id uuid not null,
  consumer_name text not null,
  processed_at timestamptz not null default now(),
  primary key (event_id, consumer_name)
);

-- MONOTONIC OFFER REVISION (prevents stale OpenSearch writes)
create table offer_state_versions (
  offer_id uuid primary key references dealer_offers,
  revision bigint not null default 1 check (revision >= 1),
  updated_at timestamptz not null default now()
);

create or replace function bump_offer_revision() returns trigger
language plpgsql as $$
begin
  insert into offer_state_versions (offer_id, revision, updated_at)
  values (new.offer_id, 1, now())
  on conflict (offer_id) do update
  set revision = offer_state_versions.revision + 1, updated_at = now();
  return new;
end $$;

create trigger trg_bump_rev_inventory
  after insert or update of quantity, reserved_quantity on inventory
  for each row execute function bump_offer_revision(); -- fires on upsert too

create trigger trg_bump_rev_offer
  after insert or update of selling_price, status on dealer_offers
  for each row execute function bump_offer_revision();


-- =====================================================================
-- PART 3: PAYMENTS AND REFUNDS
-- =====================================================================

-- Gateway SIMULATED, caps REAL
create table payments (
  payment_id uuid primary key default gen_random_uuid(),
  order_id uuid not null references orders,
  amount bigint not null check (amount > 0),
  method text not null default 'sandbox_upi',
  status text not null default 'created'
  check (status in ('created','pending','successful','failed','expired',
  'refunded','partially_refunded')),
  gateway_ref text,
  idempotency_key text unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table refunds (
  refund_id uuid primary key default gen_random_uuid(),
  order_item_id uuid not null references order_items,
  case_id uuid,
  item_amount bigint not null check (item_amount >= 0),
  fee_amount bigint not null check (fee_amount >= 0),
  kind text not null check (kind in ('path_a','path_b')),
  method text not null default 'original',
  status text not null default 'requested'
  check (status in ('requested','initiated','credited','failed')),
  gateway_ref text,
  idempotency_key text unique,
  initiated_at timestamptz,
  credited_at timestamptz,
  unique (order_item_id, kind)
);

create table after_sales_cases (
  case_id uuid primary key default gen_random_uuid(),
  order_item_id uuid not null references order_items,
  user_id uuid not null references users,
  type text not null check (type in ('cancellation','return')),
  reason_code text,
  status text not null default 'requested',
  request_key text not null,
  requested_at timestamptz not null default now(),
  closed_at timestamptz,
  unique (order_item_id, request_key)
);


-- =====================================================================
-- PART 4: FULFILMENT AND TRANSFERS (offer_id added)
-- =====================================================================

create table fulfilment_hubs (
  hub_id uuid primary key default gen_random_uuid(),
  location_id uuid not null unique references stock_locations,
  address text,
  hours jsonb,
  active boolean not null default true,
  order_capacity int not null default 20,
  delivery_radius_km numeric
);

create table hub_service_areas (
  area_id uuid primary key default gen_random_uuid(),
  hub_id uuid not null references fulfilment_hubs,
  pin_code text not null unique
);

-- Pausing a hub changes indexed availability -> bump every affected offer
create or replace function bump_revision_for_hub() returns trigger
language plpgsql as $$
begin
  if new.active is distinct from old.active then
    insert into offer_state_versions (offer_id, revision, updated_at)
    select i.offer_id, 1, now() from inventory i
    where i.location_id = new.location_id
    order by i.offer_id -- v7.2 lock order
    on conflict (offer_id) do update
    set revision = offer_state_versions.revision + 1, updated_at = now();
  end if;
  return new;
end $$;

create trigger trg_bump_rev_hub after update of active on fulfilment_hubs
  for each row execute function bump_revision_for_hub();

create table fulfilment_groups (
  group_id uuid primary key default gen_random_uuid(),
  order_id uuid not null references orders,
  location_id uuid references stock_locations,
  mode text not null check (mode in ('quick','standard','transfer')),
  status text not null default 'order_accepted',
  fee_total bigint not null default 0,
  eta_window_start timestamptz,
  eta_window_end timestamptz,
  eta_basis jsonb,
  otp_hash text not null, -- EVERY group has one, all three modes
  created_at timestamptz not null default now()
);

alter table order_items add constraint fk_group
  foreign key (group_id) references fulfilment_groups;

-- v7.1: offer_id added. The finalizer has it at INSERT time; the receipt
-- handler and the inventory-updated event key read it from RETURNING.
-- The row is created once and never re-pointed, so it cannot drift.
create table stock_transfers (
  transfer_id uuid primary key default gen_random_uuid(),
  order_item_id uuid not null unique references order_items,
  group_id uuid references fulfilment_groups,
  offer_id uuid not null references dealer_offers, -- v7.1
  from_location_id uuid not null references stock_locations,
  to_location_id uuid not null references stock_locations,
  quantity int not null check (quantity > 0),
  status text not null default 'requested' check (status in
  ('requested','in_transit','received_checked','allocated',
  'cancelled_at_origin','restocked_bangalore')),
  cancel_on_receipt boolean not null default false,
  requested_at timestamptz not null default now(),
  in_transit_at timestamptz,
  received_at timestamptz,
  allocated_at timestamptz,
  settled_at timestamptz
);

create table shipment_timeline (
  timeline_id uuid primary key default gen_random_uuid(),
  group_id uuid not null references fulfilment_groups,
  status text not null,
  event_type text not null,
  actor text,
  note text,
  created_at timestamptz not null default now()
);

create table notifications (
  notification_id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users,
  message text not null,
  event_ref text,
  created_at timestamptz not null default now(),
  read_at timestamptz
);
-- ONLY the 'notifier' consumer inserts into notifications.


-- =====================================================================
-- PART 5: FLAGGED OPTIONALS
-- =====================================================================

-- Present in the locked schema so no migration is needed later.
create table customer_addresses ( -- [FEATURE_ADDRESSES]
  address_id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users,
  label text not null default 'Home',
  recipient_name text not null,
  phone text not null,
  line1 text not null,
  line2 text,
  landmark text,
  city text not null,
  state text not null,
  pin_code text not null,
  instructions text,
  is_default boolean not null default false,
  created_at timestamptz not null default now()
);

create table user_wishlist ( -- [FEATURE_WISHLIST]
  wishlist_id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users,
  product_id uuid not null references products,
  added_at timestamptz not null default now(),
  unique (user_id, product_id)
);

create table recently_viewed (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users,
  product_id uuid not null references products,
  viewed_at timestamptz not null default now(),
  unique (user_id, product_id)
);

create table alert_subscriptions ( -- [FEATURE_ALERTS]
  subscription_id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users,
  offer_id uuid references dealer_offers,
  product_id uuid references products,
  type text not null check (type in ('back_in_stock','price_drop')),
  price_threshold_paise bigint,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table coupons ( -- [FEATURE_COUPONS]
  coupon_id uuid primary key default gen_random_uuid(),
  code text unique not null,
  kind text not null check (kind in ('fixed_paise','percent')),
  value bigint not null check (value > 0),
  min_basket_paise bigint not null default 0,
  max_redemptions int,
  redeemed_count int not null default 0 check (redeemed_count >= 0),
  per_customer_limit int not null default 1 check (per_customer_limit >= 1),
  valid_from timestamptz not null,
  valid_to timestamptz not null,
  active boolean not null default true,
  check (max_redemptions is null or redeemed_count <= max_redemptions)
);

create table coupon_customer_usage (
  coupon_id uuid not null references coupons,
  user_id uuid not null references users,
  used_count int not null default 0 check (used_count >= 0),
  primary key (coupon_id, user_id)
);

create table coupon_redemptions (
  redemption_id uuid primary key default gen_random_uuid(),
  coupon_id uuid not null references coupons,
  user_id uuid not null references users,
  order_id uuid not null references orders,
  redeemed_at timestamptz not null default now(),
  unique (coupon_id, order_id)
);


-- =====================================================================
-- PART 6: PHASE 1 PROCEDURES & FUNCTIONS
-- =====================================================================

create or replace function reserve_offer(
  p_user_id uuid,
  p_offer_id uuid,
  p_location_id uuid,
  p_quantity int,
  p_request_key text,
  p_cart_item_id uuid default null
) returns table (
  reservation_id uuid,
  status text,
  price_paise bigint,
  location_id uuid,
  expires_at timestamptz
) language plpgsql as $$
declare
  v_price bigint;
  v_res_id uuid;
  v_status text;
  v_loc_id uuid;
  v_exp timestamptz;
begin
  -- 1. qty > 0 else INVALID_QUANTITY
  if p_quantity is null or p_quantity <= 0 then
    raise exception 'INVALID_QUANTITY';
  end if;

  -- 2. Retry: existing (user_id, request_key) reservation -> return it WITH its current status and stored price_paise
  select r.reservation_id, r.status, r.price_paise, r.location_id, r.expires_at
  into v_res_id, v_status, v_price, v_loc_id, v_exp
  from reservations r
  where r.user_id = p_user_id and r.request_key = p_request_key;

  if found then
    reservation_id := v_res_id;
    status := v_status;
    price_paise := v_price;
    location_id := v_loc_id;
    expires_at := v_exp;
    return next;
    return;
  end if;

  -- 3. Read the offer's current selling_price INTO v_price
  select o.selling_price into v_price
  from dealer_offers o
  where o.offer_id = p_offer_id and o.status = 'active';

  if not found then
    raise exception 'OFFER_NOT_FOUND';
  end if;

  -- 4. hold_units: ONE conditional UPDATE reserved_quantity += qty WHERE
  --    offer/location match AND quantity - reserved_quantity >= qty AND the location is_sellable.
  --    NOT FOUND -> raise OUT_OF_STOCK
  update inventory
  set reserved_quantity = reserved_quantity + p_quantity
  where offer_id = p_offer_id
    and location_id = p_location_id
    and (quantity - reserved_quantity) >= p_quantity
    and exists (
      select 1 from stock_locations
      where location_id = p_location_id and is_sellable = true
    );

  if not found then
    raise exception 'OUT_OF_STOCK';
  end if;

  -- 5. INSERT reservation ('reserved', now()+10 min, price_paise = v_price) AND
  --    outbox 'inventory-updated' (key offer_id) in the SAME transaction
  begin
    insert into reservations (
      offer_id, location_id, user_id, quantity, price_paise, status, expires_at, request_key
    ) values (
      p_offer_id, p_location_id, p_user_id, p_quantity, v_price, 'reserved', clock_timestamp() + interval '10 minutes', p_request_key
    ) returning reservations.reservation_id, reservations.expires_at
    into v_res_id, v_exp;

    insert into outbox_events (event_type, aggregate_key, payload)
    values (
      'inventory-updated',
      p_offer_id::text,
      jsonb_build_object('offer_id', p_offer_id, 'location_id', p_location_id)
    );

    -- If cart_item_id was passed, store reservation_id on that cart item
    if p_cart_item_id is not null then
      update cart_items
      set reservation_id = v_res_id
      where cart_item_id = p_cart_item_id;
    end if;

    reservation_id := v_res_id;
    status := 'reserved';
    price_paise := v_price;
    location_id := p_location_id;
    expires_at := v_exp;
    return next;
    return;

  exception when unique_violation then
    -- ON unique_violation return the winner's row
    select r.reservation_id, r.status, r.price_paise, r.location_id, r.expires_at
    into v_res_id, v_status, v_price, v_loc_id, v_exp
    from reservations r
    where r.user_id = p_user_id and r.request_key = p_request_key;

    reservation_id := v_res_id;
    status := v_status;
    price_paise := v_price;
    location_id := v_loc_id;
    expires_at := v_exp;
    return next;
    return;
  end;
end $$;
