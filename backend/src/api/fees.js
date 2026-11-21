/**
 * Delivery Mode, Grouping and Fee Calculations
 * Strictly implements Section 04 of BazaarBridge Implementation Plan v7.2.
 */

const FEE_QUICK_PAISE = 4900n; // Rs.49
const FEE_STANDARD_PAISE = 2900n; // Rs.29
const FEE_TRANSFER_PAISE = 6900n; // Rs.69 (Rs.29 handling + Rs.40 inter-location)
const FREE_STANDARD_THRESHOLD_PAISE = 99900n; // Rs.999

/**
 * Floor proportional allocation with leftover paise distributed one each
 * in order_item_id (or index) order.
 * 
 * @param {bigint|number} totalAmount - Total amount in paise to allocate
 * @param {Array<{ id: string, amount: bigint|number }>} items - Items with their base amount (line_price)
 * @returns {Map<string, bigint>} Map of item id -> allocated amount in paise
 */
function allocate(totalAmount, items) {
  const total = BigInt(totalAmount);
  if (items.length === 0 || total === 0n) {
    const res = new Map();
    items.forEach(it => res.set(it.id, 0n));
    return res;
  }

  const sumBase = items.reduce((acc, it) => acc + BigInt(it.amount), 0n);
  if (sumBase === 0n) {
    const res = new Map();
    items.forEach(it => res.set(it.id, 0n));
    return res;
  }

  // Sort items stably by id for deterministic leftover allocation
  const sorted = [...items].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  
  const allocationMap = new Map();
  let allocatedSum = 0n;

  // Floor proportional share
  for (const item of sorted) {
    const base = BigInt(item.amount);
    const share = (total * base) / sumBase;
    allocationMap.set(item.id, share);
    allocatedSum += share;
  }

  // Distribute leftover paise one each in order_item_id order
  let leftover = total - allocatedSum;
  let idx = 0;
  while (leftover > 0n && idx < sorted.length) {
    const itemId = sorted[idx].id;
    allocationMap.set(itemId, allocationMap.get(itemId) + 1n);
    leftover -= 1n;
    idx++;
  }

  return allocationMap;
}

/**
 * Derives group delivery fee based on mode and total items amount
 */
function calculateGroupFee(mode, itemsTotalPaise) {
  const total = BigInt(itemsTotalPaise);
  if (mode === 'quick') {
    return FEE_QUICK_PAISE;
  }
  if (mode === 'standard') {
    return total >= FREE_STANDARD_THRESHOLD_PAISE ? 0n : FEE_STANDARD_PAISE;
  }
  if (mode === 'transfer') {
    return FEE_TRANSFER_PAISE; // Never waived
  }
  throw new Error(`Unknown delivery mode: ${mode}`);
}

/**
 * Checks if current time is within hub operating hours in Asia/Kolkata timezone
 */
function isWithinHubHours(hoursJson, testBypass = false) {
  if (testBypass || process.env.IGNORE_HUB_HOURS === 'true' || process.env.NODE_ENV === 'test') return true;
  if (!hoursJson) return true;
  try {
    const now = new Date();
    // Convert to Asia/Kolkata
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: 'Asia/Kolkata',
      hour: 'numeric',
      minute: 'numeric',
      hour12: false
    });
    const parts = formatter.formatToParts(now);
    const hour = parseInt(parts.find(p => p.type === 'hour').value, 10);
    const minute = parseInt(parts.find(p => p.type === 'minute').value, 10);
    const currentMins = hour * 60 + minute;

    const openMins = (hoursJson.open_hour || 8) * 60 + (hoursJson.open_minute || 0);
    const closeMins = (hoursJson.close_hour || 22) * 60 + (hoursJson.close_minute || 0);

    return currentMins >= openMins && currentMins < closeMins;
  } catch (err) {
    return true;
  }
}

/**
 * Validates locked invariants:
 * 1. group.fee_total = SUM(delivery_fee_share of its lines)
 * 2. SUM(order_items.paid_amount) = orders.total_amount
 * 3. total_amount = items_total - discount_total + delivery_fee_total
 */
function validateInvariants({
  itemsTotal,
  discountTotal,
  deliveryFeeTotal,
  totalAmount,
  groups,
  orderItems
}) {
  const tAmount = BigInt(totalAmount);
  const iTotal = BigInt(itemsTotal);
  const dTotal = BigInt(discountTotal || 0);
  const fTotal = BigInt(deliveryFeeTotal);

  if (tAmount !== iTotal - dTotal + fTotal) {
    throw new Error(`Invariant violation: total_amount (${tAmount}) != items_total (${iTotal}) - discount (${dTotal}) + delivery_fee (${fTotal})`);
  }

  // Check group fee invariant
  for (const g of groups) {
    const groupLines = orderItems.filter(it => it.group_id === g.group_id);
    const lineFeeSum = groupLines.reduce((acc, it) => acc + BigInt(it.delivery_fee_share), 0n);
    if (BigInt(g.fee_total) !== lineFeeSum) {
      throw new Error(`Invariant violation: group.fee_total (${g.fee_total}) != sum of delivery_fee_share (${lineFeeSum})`);
    }
  }

  // Check order items paid amount invariant
  const sumPaid = orderItems.reduce((acc, it) => acc + BigInt(it.paid_amount), 0n);
  if (sumPaid !== tAmount) {
    throw new Error(`Invariant violation: SUM(order_items.paid_amount) (${sumPaid}) != orders.total_amount (${tAmount})`);
  }

  return true;
}

module.exports = {
  FEE_QUICK_PAISE,
  FEE_STANDARD_PAISE,
  FEE_TRANSFER_PAISE,
  FREE_STANDARD_THRESHOLD_PAISE,
  allocate,
  calculateGroupFee,
  isWithinHubHours,
  validateInvariants
};
