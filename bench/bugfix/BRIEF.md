# Fix the checkout totals

`cart.mjs` works out what customers pay at the lantern shop's checkout. Customers have reported four problems this week:

1. "I used the code LANTERN10 and got 20% off, not 10%." (We are glad they told us.)
2. "I changed an item's quantity to 0 and was still charged for it."
3. "My basket came to exactly $50.00 and I was charged shipping, but the site says shipping is free from $50."
4. Our payment provider rejected some charges because the amount had more than two decimal places (like 24.950000000000003).

Fix all four without changing anything else about how totals are worked out (discount codes, the $5 off code's minimum,
shipping, unknown codes being ignored), add tests that would have caught each problem, and keep the existing tests
passing. `cartTotal` must keep its name and arguments and return a number of dollars rounded to the cent.

## Done means

Every reported problem is fixed and covered by a test, and nothing else changed.
