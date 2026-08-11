-- What the workspace actually does, asked during onboarding.
--
-- Until now onboarding could tell us whether a customer was one person or a
-- company, and nothing about what either of them uses the product for. org_type
-- answers "how many of you", which is the less useful half: an affiliate
-- marketer and a newsroom have the same shape and completely different needs.
--
-- Descriptive, like every other column on this row. It gates nothing, prices
-- nothing, and is writable by the workspace's own members -- see the column
-- grant at the bottom, which is the same treatment org_type, legal_name,
-- country, website and logo_url get. plan and the limits stay service-role only.
--
-- Nullable with no default. "Never asked" and "asked, and they picked
-- something" have to stay distinguishable, and a default would erase that
-- distinction for every row that already exists. Note the wrinkle it inherits:
-- onboarded_at is what gates the prompt, so the accounts already carrying a
-- timestamp will never be asked this and keep a null industry. That is the
-- correct trade -- re-opening a completed onboarding to collect one more field
-- would be worse -- and Settings is where those users can fill it in later.
alter table public.organizations
  add column if not exists industry text;

-- Enumerated rather than free text, and the list is the one in
-- landing/lib/industries.ts. Two copies, deliberately: the database is what has
-- to be right, and the TypeScript is what turns a bad value into a sentence
-- instead of a 23514. Adding a category means editing both in the same change.
--
-- Dropped first so re-running this against a database that already has the
-- constraint replaces it rather than failing, which is what lets the list grow
-- in a later migration by repeating this block.
alter table public.organizations
  drop constraint if exists organizations_industry_check;

alter table public.organizations
  add constraint organizations_industry_check check (
    industry is null or industry in (
      'affiliate',
      'ecommerce',
      'advertising',
      'agency',
      'social',
      'journalism',
      'security',
      'data',
      'crypto',
      'igaming',
      'travel',
      'recruiting',
      'software',
      'other'
    )
  );

-- Without this the onboarding form saves nothing and reports nothing: RLS
-- filters the UPDATE rather than erroring, so a missing column privilege comes
-- back as success-with-no-rows. saveOrgProfile's .select("id") is what turns
-- that into a visible failure, but the grant is what makes it work at all.
grant update("industry") on table public.organizations to authenticated;
