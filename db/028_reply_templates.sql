-- Phase 0 of the Evelyn performance scorecard: what counts as an ANSWER.
--
-- WHY THIS EXISTS
-- Every metric in the scorecard rests on one predicate — "did the bot actually
-- answer?" — and the existing version of it (answered_count in
-- bot.daily_digest_details) is wrong in both directions. Proven on two chats
-- Nelly Palikara raised on 9 Sep:
--   * session 9064f55e — it counted "Please let me know which city or club you
--     want to extend at", a CLARIFYING QUESTION, as an answer. That single
--     point defeated the link-only exception and put a chat consisting of two
--     pasted URLs on the "Bot helped" page.
--   * session d04b8c03 — it counted the OUT-OF-SCOPE REFUSAL ("I can only help
--     with things about your gym membership") as an answer, while EXCLUDING the
--     one genuinely useful reply — the member's membership number — because the
--     bot bundles it into "You're all set, Loulou!" and the auth-greeting filter
--     discarded the whole message.
-- A hand-maintained regex list is how it got there, and adding more regexes
-- would get us the same result more slowly.
--
-- THE APPROACH
-- Boilerplate is, by definition, sent verbatim to many different members. Over
-- the 7 days to 9 Sep 2026 the distribution is unusually clean:
--     5,020 templates seen in 1 session  = 52.6% of sends   (bespoke)
--        88 templates in 2-4 sessions    =  2.4%            (grey)
--        32 templates in 5-19 sessions   =  3.5%            (canned)
--        30 templates in 20+ sessions    = 41.4%            (canned)
-- So 62 templates account for 45% of everything the bot says. That is a
-- tractable, one-time, auditable labelling job — and the labels are DATA, not
-- code, so they can be corrected without a deploy.
--
-- WHY NOT JUST "REPEATED = NOT AN ANSWER"
-- Because a FAQ answer is repeated AND is an answer — and answering from the
-- FAQ is precisely the success case we are trying to count. Frequency only
-- identifies CANDIDATES; a human decides what each one is. None of the current
-- 62 is a FAQ answer, but the moment one appears it gets class 'answer' and
-- starts counting, with no change to any query.
--
-- UNCLASSIFIED DEFAULTS TO "NOT AN ANSWER". A newly frequent template is nearly
-- always new boilerplate, and the conservative direction is to understate
-- success rather than inflate it. The count of unclassified templates is
-- surfaced on the page so the backlog stays visible instead of silently
-- distorting the numbers.

-- ---------------------------------------------------------------------------
-- One definition of a reply's identity, used everywhere. IMMUTABLE so it can be
-- indexed and so the hash can never drift between writer and reader.
-- ---------------------------------------------------------------------------
create or replace function bot.reply_signature(p_content text)
returns text
language sql
immutable
as $$
  select md5(lower(regexp_replace(btrim(coalesce(p_content, '')), '\s+', ' ', 'g')));
$$;

comment on function bot.reply_signature is
  'Canonical identity of a bot reply: lowercased, whitespace-collapsed, md5. IMMUTABLE so it is indexable and cannot drift between the template table and the queries that read it.';

-- Strip the personalised login/greeting prefix so the REMAINDER can be matched
-- against a template. This cuts both ways and fixes both directions of the
-- original bug:
--   * "You're all set, Loulou! 👋 ... your membership number is 0051-5420" — the
--     greeting SWALLOWED a real answer, which the old keyword filter discarded.
--   * "Je bent ingelogd, Levy! 👋 Hmm, ik snap het niet helemaal..." — the
--     greeting SMUGGLES boilerplate past the filter, because the member's name
--     makes the reply unique so no template can ever match it.
create or replace function bot.reply_body(p_content text)
returns text
language sql
immutable
as $$
  select btrim(regexp_replace(btrim(coalesce(p_content, '')),
    '^(you.re all set|je bent ingelogd|bedankt|thanks|thank you)[^!?.]{0,45}[!?.]\s*(👋|✅|😊)?\s*',
    '', 'i'));
$$;

comment on function bot.reply_body is
  'A bot reply with its personalised login/greeting prefix removed, so boilerplate hiding behind a member name can be recognised as boilerplate.';

create table if not exists bot.reply_templates (
  template_hash text primary key,
  sample        text not null,
  class         text not null default 'unclassified',
  sessions_seen integer not null default 0,
  first_seen    timestamptz not null default now(),
  last_seen     timestamptz not null default now(),
  classified_by text,
  classified_at timestamptz,
  constraint reply_templates_class_ck check (class in (
    'answer',         -- real content: an FAQ reply, a fact about their account
    'auth',           -- email ask, OTP send / mismatch / resend, account not found
    'prompt',         -- generic greeting, "what can I help with"
    'clarify',        -- "I'm not quite sure what you're after"
    'confirm_gate',   -- "say yes to submit, no to cancel"
    'link_handoff',   -- pasted a self-service form URL
    'refusal',        -- out of scope: "I can only help with membership things"
    'breaker',        -- repeat-loop breaker, or giving up
    'cancel_notice',  -- "I've cancelled that ticket"
    'escalation',     -- offering a colleague, collecting join details
    'picker',         -- club / location list
    'ticket_prompt',  -- "tell me the details of your request"
    'closer',         -- thanks / goodbye / anything else
    'unclassified'    -- frequent but not yet labelled; treated as NOT an answer
  ))
);

comment on table bot.reply_templates is
  'Bot replies sent verbatim across many sessions, labelled by what they DO. Drives the "did the bot actually answer?" predicate. Labels are data, not code: correct one with an UPDATE, no deploy. class=''answer'' is the only value that counts as a real answer — including for a repeated FAQ reply, which is a success case.';

-- ---------------------------------------------------------------------------
-- Find newly frequent templates and park them as 'unclassified'. Never
-- overwrites an existing label — a human decision outranks rediscovery.
-- ---------------------------------------------------------------------------
create or replace function bot.discover_reply_templates(
  p_days         integer default 7,
  -- Threshold 2, not 5. At 5 the long tail of LANGUAGE VARIANTS slipped through
  -- — Spanish, Ukrainian and Arabic versions of the login prompt, and a dozen
  -- wordings of the club/term picker — and each one counted as a bespoke
  -- answer. Dropping to 2 found 90 more templates and NOT ONE was a real
  -- answer, which is the expected result: a genuine answer names the member or
  -- their data, so it never repeats across sessions.
  p_min_sessions integer default 2
)
returns table (discovered integer, still_unclassified integer)
language plpgsql
as $$
declare
  v_new integer;
begin
  -- Hash the BODY, not the raw reply. Discovering on raw text found only 62
  -- templates; discovering on bodies found 16 more that had been hiding behind
  -- a personalised greeting, including the whole "could you tell me which
  -- access level / reason for cancellation" clarifying-question family.
  with seen as (
    select bot.reply_signature(bot.reply_body(m.content)) as h,
           count(distinct m.session_id)::int as sessions,
           min(left(bot.reply_body(m.content), 400)) as sample
    from bot.conversation_messages m
    where m.role = 'assistant'
      and m.content is not null
      and length(bot.reply_body(m.content)) > 40
      and m.created_at > now() - make_interval(days => p_days)
    group by 1
    having count(distinct m.session_id) >= p_min_sessions
  ),
  ins as (
    insert into bot.reply_templates (template_hash, sample, sessions_seen)
    select s.h, s.sample, s.sessions from seen s
    on conflict (template_hash) do update
      set sessions_seen = greatest(bot.reply_templates.sessions_seen, excluded.sessions_seen),
          last_seen     = now()
    returning (xmax = 0) as inserted
  )
  select count(*) filter (where inserted)::int into v_new from ins;

  return query
    select v_new,
           (select count(*)::int from bot.reply_templates where class = 'unclassified');
end;
$$;

comment on function bot.discover_reply_templates is
  'Park newly frequent bot replies in bot.reply_templates as unclassified so they can be labelled. Never overwrites an existing label. RETURNS TABLE, never a scalar, because PostgREST renders a scalar as a bare JSON string and n8n rejects it.';

-- ---------------------------------------------------------------------------
-- Seed the 62 templates covering the 7 days to 9 Sep 2026.
--
-- The pattern matching below runs ONCE, here, to produce stored labels. It is
-- deliberately not a runtime rule: the durable artefact is the row, which a
-- human can audit and override. That is the whole point of moving this out of
-- code and into data.
-- ---------------------------------------------------------------------------
select bot.discover_reply_templates(7, 5);

update bot.reply_templates set class = c.class, classified_by = 'seed:db/028', classified_at = now()
from (
  select template_hash,
    case
      when sample ~* 'verificatiecode|verification code|code (doesn.t|i sent)|code klopt niet|laatste code|still valid for 10 minutes|geldig'
        -- NB "e-mailadres NODIG waarmee" — the Dutch inserts a word here, and a
        -- literal 'e-mailadres waarmee' misses 131 sessions of it. The
        -- unclassified default caught that rather than silently miscounting,
        -- which is the behaviour this design is for.
        or sample ~* 'share the email|e-mailadres dat bij je account hoort|e-mailadres.{0,10}waarmee het is geregistreerd|email it.s registered with|don.t see an account|zie geen account|active membership on this account'
        then 'auth'
      when sample ~* 'ticket_form=|support/tickets/new|formulier voor'                    then 'link_handoff'
      when sample ~* 'say yes to submit|zeg YES om in te dienen|YES om in te dienen'      then 'confirm_gate'
      when sample ~* 'I can only help with things about your gym membership|alleen helpen met vragen over je sportschoollidmaatschap' then 'refusal'
      when sample ~* 'keep giving you the same answer|keep repeating myself|blijf mezelf herhalen|still stuck on this' then 'breaker'
      when sample ~* 'cancelled that ticket|ticket geannuleerd'                           then 'cancel_notice'
      when sample ~* 'not quite sure what you.re after|snap het niet helemaal'            then 'clarify'
      when sample ~* 'colleague|collega|interested in joining|interesse hebt om lid te worden|geïnteresseerd bent om lid te worden|self-service for non-members' then 'escalation'
      when sample ~* 'which .* location would you like to switch to|naar welke locatie'   then 'picker'
      when sample ~* 'putting together your support ticket|samenstellen van je supportticket' then 'ticket_prompt'
      when sample ~* 'anything else i can help with|ergens mee helpen|graag gedaan|come back any ?time|kom gerust weer langs|feel free to reach out' then 'closer'
      when sample ~* '^Hi!|^Hoi!|waar kan ik je vandaag mee helpen'                       then 'prompt'
      else 'unclassified'
    end as class
  from bot.reply_templates
) c
where c.template_hash = bot.reply_templates.template_hash;

-- ---------------------------------------------------------------------------
-- THE PREDICATE. A reply is a substantive answer when it is long enough to
-- carry content and is not a labelled non-answer.
--
-- No auth-greeting exclusion here, deliberately. That regex is what discarded
-- "You're all set, Loulou! ... your membership number is 0051-5420" — a login
-- confirmation with the real answer glued onto it. Because such a reply names
-- the member and their data it is unique, so it never becomes a template and
-- correctly counts. Boilerplate is excluded by identity, not by keyword.
-- ---------------------------------------------------------------------------
-- Second discovery pass, now that bodies are hashed: picks up the boilerplate
-- that was hiding behind greetings. 16 more templates, none of them answers.
select bot.discover_reply_templates(7, 5);

update bot.reply_templates set class = c.new_class,
       classified_by = 'seed:db/028 round2 (body-hashed)', classified_at = now()
from (
  select template_hash,
    case
      when sample ~* 'ondersteuningspagina|formulier voor|ticket_form=|support/tickets/new' then 'link_handoff'
      when sample ~* 'created a support ticket|supportticket aangemaakt'                    then 'ticket_prompt'
      when sample ~* 'happy to help open a ticket|help je graag met het openen van een ticket' then 'prompt'
      when sample ~* 'I.m Evelyn, TrainMore.s membership assistant'                         then 'prompt'
      when sample ~* 'could you (please )?(tell me|let me know)|kun je me de reden'         then 'clarify'
      when sample ~* 'feel free to reach out'                                               then 'closer'
      else 'unclassified'
    end as new_class
  from bot.reply_templates where class = 'unclassified'
) c
where c.template_hash = bot.reply_templates.template_hash
  and c.new_class <> 'unclassified';

-- Third pass at threshold 2, catching the language-variant tail.
select bot.discover_reply_templates(7, 2);

update bot.reply_templates set class = c.k,
       classified_by = 'seed:db/028 round3 (threshold 2)', classified_at = now()
from (
  select template_hash,
    case
      when sample ~ '^📋|^📎' or sample ~* 'ticket preview|ticketvoorbeeld|already have ticket #' then 'ticket_prompt'
      when sample ~ '^📝' or sample ~* 'which membership would you like|welk lidmaatschap wil je|which term|welke termijn' then 'picker'
      when sample ~* 'verificatiecode|verification code|código de verificación|код підтвердження|code has expired|resend'
        or sample ~* 'e-mailadres|correo electrónico|електронна адреса|البريد الإلكتروني|share the email|geen account gekoppeld|geen lidmaatschap vinden|more than one account|geverifieerd|laatste chat is verlopen|chat timed out' then 'auth'
      when sample ~* 'ondersteuningspagina|formulier|support page|ticket_form='          then 'link_handoff'
      when sample ~* 'supportticket aangemaakt|created a support ticket'                 then 'ticket_prompt'
      when sample ~ '^❓' or sample ~* 'could you please (specify|tell me|let me know)|which city would you like|naar welke stad|had trouble processing|moeite om dat te verwerken|not sure what you.d like to change|which club would you like' then 'clarify'
      when sample ~* 'contact met een collega|colleague|everything by e-mail|alles via e-mail|like to sign up|je belt' then 'escalation'
      when sample ~* 'zeg YES|say yes to submit|reply yes'                               then 'confirm_gate'
      when sample ~* 'feel free to (ask|reach out)|anything else'                        then 'closer'
      when sample ~* '^(hi|hoi|hey|hallo|¡hola|все готово|i.m evelyn|ik ben evelyn)'     then 'prompt'
      else 'unclassified'
    end as k
  from bot.reply_templates where class = 'unclassified'
) c
where c.template_hash = bot.reply_templates.template_hash and c.k <> 'unclassified';

-- MEASURED PRECISION of the predicate below, on hand-read random samples of
-- replies it counts as answers, over the 7 days to 9 Sep 2026:
--     old answered_count (keyword filter) ~38%   (10/26)
--     + templates, URL and lifecycle rules ~62%  (15/24)
--     + ❓/📝 marker rule                   ~64%  (14/22)
--     + discovery threshold 2              ~77%  (17/22)
-- Residual errors are one nameable family: "Do you mean X or Y?" disambiguation
-- questions. Worth a rule if it matters later; not guessed at now.
create or replace function bot.is_substantive_answer(p_content text)
returns boolean
language sql
stable
as $$
  with b as (select bot.reply_body(p_content) as body)
  select length((select body from b)) > 80
     -- A self-service form URL is a HANDOFF, not an answer, however it is
     -- worded. Structural rather than template-based, because the bot
     -- personalises it ("You're all set, Kathy! ... visit
     -- extend-your-membership") and that makes it unique.
     and coalesce(p_content, '') !~* '(ticket_form=|/support/tickets/new|extend-your-membership)'
     -- Ticket LIFECYCLE is process, not content: preview, submitted
     -- confirmation, file receipt. Each carries a ticket number or filename so
     -- no template can catch it, but each has a stable marker. Nothing is lost:
     -- filing a ticket is its own outcome in the scorecard.
     and coalesce(p_content, '') !~ '📋|📎'
     and coalesce(p_content, '') !~* '✅ ?Ticket|Ticket #\d+ is (in|ingediend)|File received|Bestand ontvangen'
                                     '|heb een supportticket aangemaakt|I.ve created a support ticket'
     -- ❓ and 📝 are the bot's own markers for "I am asking you to choose".
     -- Structural and language-independent, which is what matters here: the
     -- residual errors were Greek and Spanish variants of already-labelled
     -- prompts, below the discovery threshold. MEASURED COST: 1 in 12 of these
     -- does carry a real answer before the question and is lost. Accepted — it
     -- removes 11 false positives for that 1.
     and (select body from b) !~ '^(❓|📝)'
     and coalesce(
           (select t.class = 'answer' from bot.reply_templates t
            where t.template_hash in (bot.reply_signature(p_content),
                                      bot.reply_signature((select body from b)))),
           true);
$$;

comment on function bot.is_substantive_answer is
  'True when a bot reply carries real content: over 80 characters and either unknown to bot.reply_templates (bespoke, so almost certainly a real reply) or explicitly labelled class=''answer''. Replaces the keyword-based answered_count in bot.daily_digest_details, which counted clarifying questions and out-of-scope refusals as answers and discarded real answers bundled into a login confirmation.';
