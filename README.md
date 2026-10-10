# INNER SOURCE BEAUTY ERP v1 Proper

Includes:
- Customers with Billing / Shipping / same-as-billing / payment method / terms / tax ID / notes
- Customer Detail with sales, paid, balance, orders, payments
- Inventory with brand, buying/selling price, auto margin %, low stock
- Orders with customer + inventory selection, total calculation
- Payments with Zelle, Venmo, Cash, Credit Card, Check, ACH/Wire
- Invoice print/PDF

Before using new fields, run `supabase-v1-proper-patch.sql` once in Supabase SQL Editor.
For updated inventory pricing (buying price, selling price, margin), also run `supabase-inventory-pricing-patch.sql`.

Then upload all files to GitHub and redeploy Vercel.
