import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cartTotal, formatPrice } from '../cart.mjs';

test('one item with shipping', () => {
  assert.equal(cartTotal([{ name: 'Wick', price: 2, qty: 3 }]), 10.95);
});

test('unknown codes are ignored', () => {
  assert.equal(cartTotal([{ name: 'Lantern', price: 60, qty: 1 }], { code: 'NOPE' }), 60);
});

test('formats prices', () => {
  assert.equal(formatPrice(3.5), '$3.50');
});

test('LANTERN10 takes 10% off, not 20%', () => {
  assert.equal(cartTotal([{ name: 'Lantern', price: 30, qty: 1 }], { code: 'LANTERN10' }), 31.95);
});

test('an item with quantity 0 is not charged; a missing quantity means 1', () => {
  assert.equal(cartTotal([{ name: 'Lantern', price: 30, qty: 0 }, { name: 'Wick', price: 2, qty: 1 }]), 6.95);
  assert.equal(cartTotal([{ name: 'Wick', price: 2 }]), 6.95);
});

test('shipping is free from exactly $50', () => {
  assert.equal(cartTotal([{ name: 'Lantern', price: 25, qty: 2 }]), 50);
  assert.equal(cartTotal([{ name: 'Lantern', price: 49.99, qty: 1 }]), 54.94);
});

test('totals are rounded to the cent', () => {
  assert.equal(cartTotal([{ name: 'a', price: 0.1, qty: 1 }, { name: 'b', price: 0.2, qty: 1 }, { name: 'c', price: 19.65, qty: 1 }]), 24.9);
  const t = cartTotal([{ name: 'x', price: 3.333, qty: 3 }]);
  assert.equal(t, Math.round(t * 100) / 100);
});

test('FIVEOFF still needs a $20 basket', () => {
  assert.equal(cartTotal([{ name: 'a', price: 20, qty: 1 }], { code: 'FIVEOFF' }), 19.95);
  assert.equal(cartTotal([{ name: 'a', price: 19, qty: 1 }], { code: 'FIVEOFF' }), 23.95);
});
