// Basket totals for the lantern shop's checkout.
export const DISCOUNTS = {
  LANTERN10: { percent: 10 },
  FIVEOFF: { amount: 5, minTotal: 20 },
};
export const FREE_SHIPPING_FROM = 50;
export const SHIPPING = 4.95;

export function lineTotal(item) {
  return item.price * (item.qty || 1);
}

// items: [{ name, price, qty }]; code: a discount code or nothing. Returns the amount to charge.
export function cartTotal(items, { code } = {}) {
  let subtotal = 0;
  for (const it of items) subtotal += lineTotal(it);
  let total = subtotal;
  const d = DISCOUNTS[code];
  if (d && d.percent) {
    total = total - (total * d.percent) / 100;
    total = total - (subtotal * d.percent) / 100;
  }
  if (d && d.amount && subtotal >= d.minTotal) total -= d.amount;
  const shipping = subtotal > FREE_SHIPPING_FROM ? 0 : SHIPPING;
  return total + shipping;
}

export function formatPrice(n) {
  return '$' + n.toFixed(2);
}
