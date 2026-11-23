# Sales at a glance

A one-page sales dashboard for a small lantern shop, built from the file `data/sales.csv` already in this repository
(columns: date, region, product, units, unit_price; revenue is units × unit_price). The owner opens it to see how the
business is doing without a spreadsheet.

- The total revenue for the selected period, as money (for example `$12,345.67`).
- Revenue by region, in a table, largest first, with each region's share of the total.
- A chart of revenue by month.
- A month filter ("All months" or one month) that updates everything on the page.
- Readable at a glance, works on a laptop and a phone, and stays correct if the CSV grows.

## Interface (for automated testing; keep these exactly)

Plain static files: `index.html` at the repository root (or in `dist/` after `npm run build`), served by any static web
server with the CSV at `data/sales.csv` next to it (it reads the file when the page loads; no backend). Elements:
`data-testid="total-revenue"` (the total, formatted as dollars with a thousands separator and two decimals),
`data-testid="region-row"` on each table row with a `data-region` attribute holding the region's name and, inside it,
`data-testid="region-revenue"` (formatted the same way), `data-testid="month-filter"` (a `<select>` whose option values
are `all` and months as `YYYY-MM`), `data-testid="chart"` (an `<svg>` or `<canvas>`).

## Done means

The owner can see the totals, the best region and how each month went, and look at any one month.
