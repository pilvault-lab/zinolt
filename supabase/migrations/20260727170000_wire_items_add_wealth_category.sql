-- Add the 'wealth' category alongside the existing five. Without this the
-- inserts for wealth-tagged sources (SEC Form 4 watchlist, Fortune, Forbes
-- Business, Bloomberg Wealth, etc.) would fail the CHECK constraint.

alter table public.wire_items
  drop constraint wire_items_category_check;

alter table public.wire_items
  add constraint wire_items_category_check
    check (category in ('markets','fintech','tech','predictions','culture','wealth'));
