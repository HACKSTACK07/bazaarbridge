-- =====================================================================
-- reserve_offer PL/pgSQL function
-- Authoritative Phase 1 implementation by Agent B
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
