-- What Evelyn actually knows: one row per individual fact she can answer from.
--
-- WHY THIS IS NOT THE KNOWLEDGE REGISTER
-- db/033 (`bot.knowledge_sources`) answers "which documents and feeds shape
-- what she knows" — 7 rows, one per artefact. This answers the question
-- underneath it: what is IN those artefacts, fact by fact. A Member Care agent
-- who wants to say "that answer is wrong" cannot do it against a register of
-- seven sources; they need the sentence itself in front of them, with somewhere
-- to write what it should say instead.
--
-- So the four libraries now read, outermost to innermost:
--   /scenarios  — what she RECOGNISES
--   /library    — what she DOES about it
--   /knowledge  — the DOCUMENTS behind that
--   /knows      — the FACTS inside those documents        <- this table
--
-- THE UNIT IS THE ARTICLE, NOT THE CHUNK
-- The vector store holds 182 chunks but only 162 distinct articles: long
-- articles are split for retrieval. The chunk is what the bot retrieves; the
-- ARTICLE is what a human can open and edit. A note has to attach to the thing
-- someone can go and fix, so the row is the article and `chunks` records how
-- many pieces it is stored as.
--
-- THE ROWS ARE GENERATED, NOT HAND-WRITTEN
-- Like db/034 and unlike db/032 and db/033, these rows are built from the live
-- stores by tools/knowledge/items.js and written by items-seed.js. They must
-- be: the FAQ store is rebuilt from scratch every morning, so a hand-curated
-- copy of it would be wrong within a day and give no signal that it had drifted.
-- Editing a row by hand is overwritten on the next run.
--
-- The one exception is `prompt` — knowledge typed into an n8n system prompt.
-- Nothing can read those out programmatically, so they are curated in the
-- generator next to the code that reads everything else. They are marked
-- wiring='deploy' and carry their own verified_at.
--
-- THE DEMAND NUMBERS ARE THE WEAKEST THING ON THIS PAGE
-- Nothing logs which FAQ was retrieved for which conversation — there is no
-- retrieval log anywhere in this database, checked 13 Sep 2026. So "how often
-- is this asked" cannot be measured, only ESTIMATED, by matching real member
-- messages against each item's own words.
--
-- That is a weaker instrument than the one behind db/034. There, twenty
-- matchers were hand-written and tuned per question. Here the keywords are
-- derived automatically from ~180 titles, so they cannot be tuned individually
-- and they inherit whatever the title happens to say. Both under-claim; this
-- one under-claims harder and less evenly. `demand_method` names the instrument
-- on every row so the number is never read as a measurement, and the page says
-- so in words.
--
-- SCOPE: TrainMore.

-- ---------------------------------------------------------------------------
-- 1. knowledge_items — the facts themselves
-- ---------------------------------------------------------------------------
create table if not exists bot.knowledge_items (
  key            text primary key,
  sort_order     integer not null default 100,
  brand          text not null default 'trainmore',

  -- Which store this fact lives in. Drives the source tag on the page.
  source         text not null,
  -- Soft reference into bot.knowledge_sources. Soft for the same reason
  -- db/037's ultimate_source_keys are: this table is rebuilt wholesale, and a
  -- real FK would either block that rebuild or cascade into the register.
  source_key     text,
  -- Denormalised from the source so the chip renders without a join, and
  -- because a prompt-embedded item has no register row of its own to inherit
  -- from. This is the tag that decides what an agent's note is worth: a
  -- correction to a `live` item lands tomorrow morning, a correction to a
  -- `deploy` item waits on engineering.
  wiring         text not null,

  title          text not null,
  -- The actual words. This is the point of the table: an agent cannot judge an
  -- answer they cannot read.
  body           text not null,
  -- Where to go and change it. Null for facts with no editable address.
  url            text,
  topic          text not null,
  tags           text[] not null default '{}',
  -- What is known to be wrong or fragile about this specific fact — kept out of
  -- `body` so the page can flag it rather than bury it mid-paragraph, the same
  -- split bot.knowledge_sources makes with `risk`.
  caveat         text,

  -- How many vector chunks this one article is stored as. 1 for everything
  -- that is not a long Freshdesk article.
  chunks         integer not null default 1,
  -- Set when the same article also arrives through a second feed. Points at
  -- the item we treat as canonical; the duplicate is still listed, because
  -- hiding it is how the duplication stays invisible.
  duplicate_of   text,

  -- Derived demand. See the header: a floor, from an automatic matcher.
  matched_messages integer,
  matched_sessions integer,
  demand_method  text,
  -- The terms that produced those counts, stored so the number can be argued
  -- with. A demand figure whose matcher is hidden is not checkable.
  demand_terms   text[] not null default '{}',
  window_from    date,
  window_to      date,
  -- Real member messages, masked to the same rules as db/034, with the session
  -- ids alongside so each quote opens the conversation it came from.
  examples         text[] not null default '{}',
  example_sessions text[] not null default '{}',

  verified_at    date not null default current_date,

  constraint knowledge_items_wiring_ck check (wiring in ('live','deploy','not_wired')),
  constraint knowledge_items_source_ck check (source in (
    'freshdesk',      -- a published help article, synced daily
    'spreadsheet',    -- TrainMore FAQs.xlsx, synced daily
    'member_care',    -- bot.manual_faqs, hand-written, synced daily
    'club_directory', -- one club's hours, prices and facilities
    'prompt'          -- typed into an n8n system prompt; needs a deploy
  )),
  -- The examples and their session ids are two halves of one fact.
  constraint knowledge_items_examples_ck
    check (cardinality(examples) = cardinality(example_sessions))
);

create index if not exists knowledge_items_demand_idx
  on bot.knowledge_items (matched_sessions desc nulls last);
create index if not exists knowledge_items_topic_idx
  on bot.knowledge_items (topic);

comment on table bot.knowledge_items is
  'Every individual fact Evelyn can answer from, one row per ARTICLE (not per vector chunk). Rows are GENERATED from the live stores by tools/knowledge/items.js + items-seed.js, because the FAQ store is rebuilt nightly and a hand-curated copy would silently drift. Complements bot.knowledge_sources, which covers the documents rather than their contents.';
comment on column bot.knowledge_items.body is
  'The actual text the bot answers from. The reason this table exists: an agent cannot judge an answer they cannot read.';
comment on column bot.knowledge_items.wiring is
  'live = re-read automatically, a correction lands tomorrow morning; deploy = typed into an n8n node, a correction waits on a release; not_wired = nothing reads it.';
comment on column bot.knowledge_items.duplicate_of is
  'Set when the same article also arrives through a second feed. The duplicate is still listed rather than merged away: hiding it is how the duplication stays invisible.';
comment on column bot.knowledge_items.matched_sessions is
  'A FLOOR from an AUTOMATIC matcher, and the weakest number on the page. Nothing logs which FAQ was retrieved, so this is member messages matched against the item own words. Weaker than bot.question_traces, whose matchers are hand-tuned per question.';
comment on column bot.knowledge_items.demand_terms is
  'The terms that produced the counts, stored so the number can be argued with rather than taken on trust.';
comment on column bot.knowledge_items.chunks is
  'How many vector chunks this one article is split into for retrieval. The chunk is what the bot retrieves; the article is what a person can open and edit, which is why the row is the article.';

-- ---------------------------------------------------------------------------
-- 2. knowledge_item_notes — what an agent says about a fact
-- ---------------------------------------------------------------------------
-- Deliberately its own table with NO foreign key, exactly as bot.question_notes
-- is to bot.question_traces, and for a sharper version of the same reason: the
-- items are a mirror of a store that is rebuilt from scratch every morning.
-- A note held on the item row would be destroyed by the next generator run —
-- silently, and noticed only by whoever went looking for a correction they
-- wrote a fortnight ago.
--
-- ON DELETE CASCADE would delete every note on each refresh; a plain FK would
-- make the refresh fail as soon as one note existed. So item_key is soft. A
-- note whose article has since been retired survives here and stops being
-- displayed, which is the right trade: losing the record of what someone
-- raised is worse than keeping it without its article.
--
-- WHY `kind`
-- "This is wrong" and "this is right but members never find it" are different
-- pieces of work and go to different people. One free-text box would collapse
-- them, and the difference is the part worth routing on.
create table if not exists bot.knowledge_item_notes (
  id           uuid primary key default gen_random_uuid(),
  item_key     text not null,
  author_email text not null,
  kind         text not null default 'wrong',
  note         text not null,
  created_at   timestamptz not null default now(),
  resolved_at  timestamptz,
  resolved_by  text,
  constraint knowledge_item_notes_kind_ck check (kind in (
    'wrong',      -- the answer is incorrect
    'outdated',   -- it was right once
    'unclear',    -- right, but members misread it
    'missing',    -- something that should be here is not
    'context'     -- background for whoever reads this next; not work
  ))
);

create index if not exists knowledge_item_notes_key_idx
  on bot.knowledge_item_notes (item_key, created_at desc);
create index if not exists knowledge_item_notes_open_idx
  on bot.knowledge_item_notes (created_at desc) where resolved_at is null;

comment on table bot.knowledge_item_notes is
  'What Member Care says about one piece of the bot knowledge. NO foreign key to bot.knowledge_items on purpose: that table mirrors a store rebuilt nightly and is re-seeded with a delete-all, so a cascading FK would destroy every note and a plain FK would break the refresh. item_key is a soft reference.';
comment on column bot.knowledge_item_notes.kind is
  'wrong / outdated / unclear / missing / context. Separated because "this is incorrect" and "this is right but unfindable" are different work and go to different people.';
comment on column bot.knowledge_item_notes.resolved_at is
  'Set by Done rather than deleting the row. The value is the record of what was raised and when, not a tidy list.';

-- ---------------------------------------------------------------------------
-- 3. The view
-- ---------------------------------------------------------------------------
-- Note counts are joined live rather than kept as a column: a counter on the
-- item row would be reset to zero by every generator run, which is the same
-- trap the notes table is built to avoid.
drop function if exists bot.knowledge_items_view();

create function bot.knowledge_items_view()
returns table (
  key text, sort_order integer, brand text,
  source text, source_key text, wiring text,
  title text, body text, url text, topic text, tags text[], caveat text,
  chunks integer, duplicate_of text,
  matched_messages integer, matched_sessions integer,
  demand_method text, demand_terms text[],
  window_from date, window_to date,
  examples text[], example_sessions text[],
  verified_at date,
  source_name text, source_url text,
  open_notes bigint, total_notes bigint
)
language sql
stable
as $function$
  select i.key, i.sort_order, i.brand,
         i.source, i.source_key, i.wiring,
         i.title, i.body, i.url, i.topic, i.tags, i.caveat,
         i.chunks, i.duplicate_of,
         i.matched_messages, i.matched_sessions,
         i.demand_method, i.demand_terms,
         i.window_from, i.window_to,
         i.examples, i.example_sessions,
         i.verified_at,
         k.name, k.url,
         coalesce(n.open_notes, 0), coalesce(n.total_notes, 0)
  from bot.knowledge_items i
  -- Joined, never copied, so a source renamed in the register is renamed here.
  left join bot.knowledge_sources k on k.key = i.source_key
  left join lateral (
    select count(*) filter (where resolved_at is null) as open_notes,
           count(*) as total_notes
    from bot.knowledge_item_notes nn
    where nn.item_key = i.key
  ) n on true
  order by i.matched_sessions desc nulls last, i.sort_order, i.key;
$function$;

comment on function bot.knowledge_items_view is
  'The knowledge items in demand order, with the source resolved from bot.knowledge_sources and note counts joined live. Note counts are joined rather than stored because a counter column would be zeroed by every generator run.';

-- ---------------------------------------------------------------------------
-- 4. Default-deny, as db/001 does
-- ---------------------------------------------------------------------------
-- RLS on with no permissive policy = nothing for anon or authenticated. Both
-- the app and the generator use service_role, which bypasses RLS, so this
-- cannot break either. The notes table carries staff e-mail addresses, which is
-- reason enough on its own; the items table gets the same treatment so the two
-- do not drift apart.
alter table bot.knowledge_items      enable row level security;
alter table bot.knowledge_item_notes enable row level security;

-- Re-seed:  node tools/knowledge/items.js && node tools/knowledge/items-seed.js
