-- Evelyn Ops — tester impersonation profiles (developer tool).
--
-- Lets an ALLOW-LISTED internal email log into the LIVE bot with FAKE Magicline
-- data, to emulate arbitrary member profiles for testing without touching real
-- members or the Magicline API. Gated strictly to tester_email; the OTP still
-- goes to the real inbox, so only the tester can actually log in — only the
-- returned *profile* is fake.
--
-- Read by the bot at two hook points:
--   1. Bot - Get customer information (Auth): if the login email is a tester,
--      return the active row's `customer` instead of the Magicline search.
--   2. ML - get contract info: if the customerId is a tester customer, return
--      the active row's `contract` instead of calling Magicline.

create table if not exists bot.test_profiles (
  id           uuid primary key default gen_random_uuid(),
  tester_email text not null,          -- the allow-listed login email
  label        text not null,          -- scenario name, e.g. 'in-contract member @ Holendrecht'
  active       boolean not null default false,  -- which scenario is used on login
  customer     jsonb not null,         -- fake Magicline customer: a single object, OR an
                                       -- ARRAY of customers to emulate multiple accounts
                                       -- (triggers the bot's account-picker flow)
  contract     jsonb,                  -- fake contract(s), shape of ML get-contract output
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index if not exists test_profiles_email_idx on bot.test_profiles (lower(tester_email));
-- At most one active scenario per tester at a time.
create unique index if not exists test_profiles_one_active
  on bot.test_profiles (lower(tester_email)) where active;

alter table bot.test_profiles enable row level security;
revoke all on bot.test_profiles from anon, authenticated;
grant all on bot.test_profiles to service_role;

-- Seed: one in-contract MEMBER scenario for the tester. studioId 1224518210 is a
-- real club (Amsterdam Holendrecht) so studio/app-key resolution works; the
-- customerId 999000001 is synthetic (never in Magicline) so unhooked tools
-- simply return no data.
insert into bot.test_profiles (tester_email, label, active, customer, contract)
values (
  'bryan.medina.per@gmail.com',
  'In-contract MEMBER @ Amsterdam Holendrecht',
  true,
  '{"id": 999000001, "customerNumber": "TEST-0001", "firstName": "Bryan", "lastName": "Tester", "email": "bryan.medina.per@gmail.com", "status": "MEMBER", "studioId": 1224518210, "dateOfBirth": "1990-01-01", "gender": "MALE", "accessRestrictions": [], "preferredLanguage": {"languageCode": "en", "countryCode": "NL"}, "createdDateTime": "2026-01-15T10:00:00.000000+01:00"}'::jsonb,
  '[{"id": 999100001, "startDate": "2026-01-15", "endDate": "2027-01-14", "rateName": "TM REG B2C HOME AMS Holendrecht (TEST)", "contractStatus": "ACTIVE", "cancellationPeriod": {"periodValue": 1, "periodUnit": "MONTH"}, "cancelled": false, "cancellationDate": null, "cancellationReason": null, "price": 47, "priceDetails": {"basePrice": {"amount": 47, "currency": "EUR"}, "currentPrice": {"amount": 47, "currency": "EUR"}, "paymentFrequency": {"type": "RECURRING", "term": {"value": 4, "unit": "WEEK"}}}, "lastPossibleCancellationDate": "2026-12-14", "term": {"periodValue": 1, "periodUnit": "YEAR"}, "extensionTerm": {"periodValue": 1, "periodUnit": "MONTH"}}]'::jsonb
)
on conflict do nothing;

-- Second scenario (inactive): MULTI-ACCOUNT. `customer` is an ARRAY of two members
-- (both at real, keyed studios) so login triggers the account-picker. Flip `active`
-- to switch between scenarios (one active per tester is enforced).
insert into bot.test_profiles (tester_email, label, active, customer, contract)
values (
  'bryan.medina.per@gmail.com',
  'Multi-account: MEMBER @ Holendrecht + West Ladies',
  false,
  '[
    {"id": 999000001, "customerNumber": "TEST-0001", "firstName": "Bryan", "lastName": "Tester", "email": "bryan.medina.per@gmail.com", "status": "MEMBER", "studioId": 1224518210, "accessRestrictions": [], "createdDateTime": "2026-01-15T10:00:00.000000+01:00"},
    {"id": 999000002, "customerNumber": "TEST-0002", "firstName": "Bryan", "lastName": "Tester", "email": "bryan.medina.per@gmail.com", "status": "MEMBER", "studioId": 1224538480, "accessRestrictions": [], "createdDateTime": "2026-02-15T10:00:00.000000+01:00"}
  ]'::jsonb,
  '[{"id": 999100002, "startDate": "2026-02-15", "endDate": "2027-02-14", "rateName": "TM REG B2C HOME AMS West Ladies (TEST)", "contractStatus": "ACTIVE", "cancelled": false, "lastPossibleCancellationDate": "2027-01-14", "priceDetails": {"currentPrice": {"amount": 52, "currency": "EUR"}, "paymentFrequency": {"type": "RECURRING"}}, "term": {"periodValue": 1, "periodUnit": "YEAR"}, "extensionTerm": {"periodValue": 1, "periodUnit": "MONTH"}}]'::jsonb
)
on conflict do nothing;
