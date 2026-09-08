-- Remember that a visitor has told us they have no account.
--
-- THE BUG. `Answer Before Ticket?` in Bot - Authenticate decides per message
-- whether a pre-login visitor gets an answer or another request for the e-mail
-- on their membership. It is stateless: it re-tests the CURRENT message against
-- a non-membership / question / public-topic allow-list every turn. So a
-- visitor who says "I don't have an account" gets answered for that one
-- message, and the next message that happens not to match the allow-list falls
-- straight back to Build No-Email Reply — "To look up your account I'll need
-- the email it's registered with".
--
-- Measured 24 Aug - 8 Sep 2026: 213 sessions said they had no account or were
-- not a member. 166 of them (77.9%) are still sitting in state
-- `awaiting_email`; 96 kept trying through five or more messages. Sentiment on
-- that cohort: avg 2.57 and 39.3% negative, against 2.87 / 14.1% across all
-- scored conversations — nearly three times the negative rate, and these are
-- prospective members.
--
-- Worked example, session fac2ca05 (4 Sep, ticket 634616): Jesse said he had no
-- account three times and asked twice for someone to walk him through the
-- options. Each time he was asked for his account e-mail. He finished with
-- "what the fuck is this chat?", which the bot then captured as his NAME and
-- put in the ticket subject.
--
-- THE FIX. Make non-membership sticky for the session. Once stated, stop asking
-- for an account e-mail and keep answering. The two existing escape hatches in
-- that gate are untouched and still take precedence, so this cannot trap
-- anyone: a message containing an e-mail address still goes to the lookup, and
-- asking for a ticket or a human still goes to the sales/ticket path.

-- COUPLED to the `notMember` regex inside `Answer Before Ticket?` in
-- Bot - Authenticate. Kept deliberately identical rather than invented fresh;
-- if one changes, change the other. (The two request-type classifiers in
-- Bot - Ticket Collection Agent are documented as coupled for the same reason
-- and have drifted before.)
create or replace function bot.note_no_account(
  p_session_id uuid,
  p_message    text
)
returns boolean
language plpgsql
as $$
declare
  v_match boolean;
begin
  v_match := coalesce(p_message, '') ~*
    '(nog\s+geen\s+lid|ik\s+ben\s+geen\s+lid|geen\s+lid|geen\s+account|zonder\s+account'
    '|geen\s+lidmaatschap|niet\s+ingeschreven|not\s+a\s+member|no\s+account'
    '|don''?t\s+have\s+(an?\s+)?acc(ount)?|dont\s+have\s+(an?\s+)?acc(ount)?'
    '|haven''?t\s+got\s+(an?\s+)?account|don''?t\s+have\s+a\s+membership'
    '|dont\s+have\s+a\s+membership|no\s+(membership|subscription))';

  if not v_match then
    return false;
  end if;

  -- Merge, never replace: the context also holds last_email, pending_query and
  -- not_found_count, and a wholesale write would drop them.
  update bot.sessions
     set context = coalesce(context, '{}'::jsonb)
                   || jsonb_build_object('no_account_declared', true,
                                         'no_account_declared_at', now())
   where id = p_session_id;

  return true;
end;
$$;

comment on function bot.note_no_account is
  'Sets context.no_account_declared when a pre-login visitor states they have no account, so Answer Before Ticket? keeps answering instead of re-asking for an account e-mail. Merges into context rather than replacing it.';
