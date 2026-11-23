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
