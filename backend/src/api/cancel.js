/**
 * BazaarBridge Order Item Cancellation State Machine
 * Real Phase 2 Implementation strictly adhering to agent-rules.md Section 7 & 8
 */

const { getClient } = require('../db');
const { release_hold, restock_units } = require('../db/stock');

/**
 * Cancels an order item atomically in ONE database transaction.
 * 
 * @param {string} orderId - The parent order UUID
 * @param {string} orderItemId - The specific item UUID to cancel
 * @param {string} userId - Authenticated user UUID
 * @param {string} requestKey - Idempotency request key
 */
async function cancelOrderItem(orderId, orderItemId, userId, requestKey) {
  if (!orderItemId || !requestKey) {
    const err = new Error('order_item_id and request_key are required');
    err.status = 400;
    err.code = 'INVALID_INPUT';
    throw err;
  }

  const client = await getClient();
  try {
    await client.query('BEGIN');

    // a. REPLAY CHECK: existing after_sales_cases row for (order_item_id, request_key)
    const replayCheck = await client.query(`
      SELECT c.case_id, c.status as case_status,
             r.refund_id, r.status as refund_status, r.item_amount, r.fee_amount
      FROM after_sales_cases c
      LEFT JOIN refunds r ON r.case_id = c.case_id
      WHERE c.order_item_id = $1 AND c.request_key = $2;
    `, [orderItemId, requestKey]);

    if (replayCheck.rowCount > 0) {
      await client.query('ROLLBACK');
      const row = replayCheck.rows[0];
      const totalRefund = BigInt(row.item_amount || 0) + BigInt(row.fee_amount || 0);
      return {
        status: 200,
        data: {
          case_id: row.case_id,
          refund: {
            refund_id: row.refund_id,
            status: row.refund_status || 'requested',
            amount: Number(totalRefund)
          }
        }
      };
    }

    // Verify ownership of the order
    const orderCheck = await client.query(
      'SELECT user_id, status FROM orders WHERE order_id = $1;',
      [orderId]
    );
    if (orderCheck.rowCount === 0) {
      await client.query('ROLLBACK');
      const err = new Error('Order not found');
      err.status = 404;
      err.code = 'NOT_FOUND';
      throw err;
    }
    if (orderCheck.rows[0].user_id !== userId) {
      await client.query('ROLLBACK');
      const err = new Error('Forbidden');
      err.status = 403;
      err.code = 'FORBIDDEN';
      throw err;
    }

    // b. GATE - atomic conditional transition (only the winner proceeds):
    // UPDATE order_items SET item_status='cancelled', cancelled_at=now()
    // WHERE order_item_id=$1 AND item_status IN ('placed','confirmed')
    // AND (group_id IS NULL OR NOT EXISTS (
    //   SELECT 1 FROM fulfilment_groups g
    //   WHERE g.group_id=order_items.group_id
    //   AND g.status IN ('picked_up','out_for_delivery','delivered','cancelled')))
    const gateSql = `
      UPDATE order_items
      SET item_status = 'cancelled', cancelled_at = now()
      WHERE order_item_id = $1
        AND order_id = $2
        AND item_status IN ('placed', 'confirmed')
        AND (group_id IS NULL OR NOT EXISTS (
          SELECT 1 FROM fulfilment_groups g
          WHERE g.group_id = order_items.group_id
            AND g.status IN ('picked_up', 'out_for_delivery', 'delivered', 'cancelled')
        ))
      RETURNING stock_finalised, reservation_id, offer_id, stock_location_id,
                quantity, item_paid_amount, delivery_fee_share, group_id;
    `;
    const gateRes = await client.query(gateSql, [orderItemId, orderId]);

    if (gateRes.rowCount === 0) {
      await client.query('ROLLBACK');
      const err = new Error('Item is already cancelled or too late to cancel');
      err.status = 409;
      err.code = 'ALREADY_CANCELLED_OR_TOO_LATE';
      throw err;
    }

    const {
      stock_finalised,
      reservation_id,
      offer_id,
      stock_location_id,
      quantity,
      item_paid_amount,
      delivery_fee_share,
      group_id
    } = gateRes.rows[0];

    // c. IF stock_finalised = FALSE (consumer has not run yet):
    // The reservation is 'confirmed', NOT 'reserved'. Release the CONFIRMED hold.
    if (!stock_finalised) {
      const releaseResv = await client.query(`
        UPDATE reservations
        SET status = 'released'
        WHERE reservation_id = $1 AND status = 'confirmed'
        RETURNING 1;
      `, [reservation_id]);

      if (releaseResv.rowCount === 0) {
        throw new Error('RESERVATION_STATE_CONFLICT');
      }

      await release_hold(client, offer_id, stock_location_id, quantity);
      // quantity UNCHANGED; stock_finalised stays false forever on this line
    } else {
      // d. IF stock_finalised = TRUE: ORDERED FALL-THROUGH.
      // Every statement is conditional with RETURNING. Move stock ONLY on a match.
      let settled = false;

      // T1: stock_transfers status='requested'
      const t1Res = await client.query(`
        UPDATE stock_transfers
        SET status = 'cancelled_at_origin', settled_at = now()
        WHERE order_item_id = $1 AND status = 'requested'
        RETURNING from_location_id, quantity;
      `, [orderItemId]);

      if (t1Res.rowCount === 1) {
        const { from_location_id, quantity: tQty } = t1Res.rows[0];
        await restock_units(client, offer_id, from_location_id, tQty);
        settled = true;
      }

      // T2: stock_transfers status='in_transit'
      if (!settled) {
        const t2Res = await client.query(`
          UPDATE stock_transfers
          SET cancel_on_receipt = true
          WHERE order_item_id = $1 AND status = 'in_transit'
          RETURNING 1;
        `, [orderItemId]);

        if (t2Res.rowCount === 1) {
          // NO stock movement now; settled := true
          settled = true;
        }
      }

      // T3: stock_transfers status='received_checked'
      if (!settled) {
        const t3Res = await client.query(`
          UPDATE stock_transfers
          SET status = 'restocked_bangalore', cancel_on_receipt = true, settled_at = now()
          WHERE order_item_id = $1 AND status = 'received_checked'
          RETURNING to_location_id, quantity;
        `, [orderItemId]);

        if (t3Res.rowCount === 1) {
          const { to_location_id, quantity: tQty } = t3Res.rows[0];
          await restock_units(client, offer_id, to_location_id, tQty);
          settled = true;
        }
      }

      // T4: stock_transfers status='allocated'
      if (!settled) {
        const t4Res = await client.query(`
          UPDATE stock_transfers
          SET status = 'restocked_bangalore', settled_at = now()
          WHERE order_item_id = $1 AND status = 'allocated'
          RETURNING to_location_id, quantity;
        `, [orderItemId]);

        if (t4Res.rowCount === 1) {
          const { to_location_id, quantity: tQty } = t4Res.rows[0];
          await restock_units(client, offer_id, to_location_id, tQty);
          settled = true;
        }
      }

      // FALL-THROUGH: IF NOT settled:
      if (!settled) {
        const checkTransfer = await client.query(
          'SELECT status FROM stock_transfers WHERE order_item_id = $1;',
          [orderItemId]
        );

        if (checkTransfer.rowCount === 0) {
          // none -> plain restock
          await restock_units(client, offer_id, stock_location_id, quantity);
          settled = true;
        } else {
          const tStatus = checkTransfer.rows[0].status;
          if (tStatus === 'cancelled_at_origin' || tStatus === 'restocked_bangalore') {
            // NO movement; the other path already settled the units
            settled = true;
          } else {
            throw new Error(`TRANSFER_STATE_CONFLICT: unexpected status ${tStatus}`);
          }
        }
      }
    }

    // e. Insert after_sales_cases
    const caseRes = await client.query(`
      INSERT INTO after_sales_cases (order_item_id, user_id, type, reason_code, status, request_key)
      VALUES ($1, $2, 'cancellation', 'customer_cancelled', 'approved', $3)
      RETURNING case_id;
    `, [orderItemId, userId, requestKey]);
    const caseId = caseRes.rows[0].case_id;

    // Insert refunds row (kind 'path_a', status 'requested')
    const itemAmount = BigInt(item_paid_amount || 0);
    const feeAmount = BigInt(delivery_fee_share || 0);
    const refundRes = await client.query(`
      INSERT INTO refunds (order_item_id, case_id, item_amount, fee_amount, kind, status)
      VALUES ($1, $2, $3, $4, 'path_a', 'requested')
      RETURNING refund_id, item_amount, fee_amount, status;
    `, [orderItemId, caseId, itemAmount.toString(), feeAmount.toString()]);
    const refund = refundRes.rows[0];

    // Insert ONE outbox event: 'order-item-cancelled' (aggregate_key = offer_id)
    // DO NOT emit 'notification-created'. DO NOT emit 'inventory-updated'.
    await client.query(`
      INSERT INTO outbox_events (event_type, aggregate_key, payload)
      VALUES ('order-item-cancelled', $1, $2);
    `, [
      offer_id,
      JSON.stringify({
        order_id: orderId,
        order_item_id: orderItemId,
        offer_id,
        refund_id: refund.refund_id,
        case_id: caseId
      })
    ]);

    // If every item in the group is now cancelled, set that group's status='cancelled'
    if (group_id) {
      const remainingItems = await client.query(`
        SELECT count(*)::int as active_count
        FROM order_items
        WHERE group_id = $1 AND item_status != 'cancelled';
      `, [group_id]);

      if (remainingItems.rows[0].active_count === 0) {
        await client.query(
          "UPDATE fulfilment_groups SET status = 'cancelled' WHERE group_id = $1;",
          [group_id]
        );
      }
    }

    // If all items in the order are now cancelled, set order status='cancelled'
    const remainingOrderItems = await client.query(`
      SELECT count(*)::int as active_count
      FROM order_items
      WHERE order_id = $1 AND item_status != 'cancelled';
    `, [orderId]);

    if (remainingOrderItems.rows[0].active_count === 0) {
      await client.query(
        "UPDATE orders SET status = 'cancelled' WHERE order_id = $1;",
        [orderId]
      );
    }

    await client.query('COMMIT');

    const totalRefundAmount = BigInt(refund.item_amount) + BigInt(refund.fee_amount);
    return {
      status: 200,
      data: {
        case_id: caseId,
        refund: {
          refund_id: refund.refund_id,
          status: refund.status,
          amount: Number(totalRefundAmount)
        }
      }
    };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

module.exports = { cancelOrderItem };
