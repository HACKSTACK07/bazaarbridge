-- backend/src/tests/reconciliation.sql
-- Phase 1 Reconciliation Query: Order Items vs Orders Total Amount
-- Invariant: sum(paid_amount) per order = orders.total_amount
-- Anomaly check: Returns zero rows when healthy. Any row returned is a reconciliation violation.

SELECT
  o.order_id,
  o.total_amount,
  COALESCE(SUM(oi.paid_amount), 0) AS calculated_items_total,
  (o.total_amount - COALESCE(SUM(oi.paid_amount), 0)) AS discrepancy_paise
FROM orders o
LEFT JOIN order_items oi ON oi.order_id = o.order_id
GROUP BY o.order_id, o.total_amount
HAVING o.total_amount <> COALESCE(SUM(oi.paid_amount), 0);
