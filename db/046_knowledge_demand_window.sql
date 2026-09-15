-- 046: make the demand figure on /knows answerable for ANY date range.
--
-- Until now matched_sessions was computed once, offline, by tools/knowledge/items.js
-- against a 7.2 MB checked-in export (tools/review/messages.json) and stamped into
-- every row with the same window_from/window_to. So the page could only ever show
-- one window, and that window went stale the moment the export did: on 15 Sep 2026
-- every one of the 233 rows still read 11 Aug - 11 Sep.
--
-- This moves the COUNTING to the database, over live bot.conversation_messages,
-- while leaving the TERM SELECTION in items.js where it belongs (it needs the FAQ
-- store, the club sheet and the Dutch synonym map). items.js now persists the
-- matching spec; this function applies it to whatever window is asked for.
--
-- The spec is stored PRE-FILTER on purpose. items.js used to drop a term because
-- it matched nothing, or because it was too common, in ITS corpus. Both of those
-- are properties of a window, not of the item, so they have to be re-decided per
-- window here or the count silently inherits last month's vocabulary.
--
-- What is reproduced from items.js, exactly:
--   * normalise: lowercase, strip diacritics, non-alphanumeric -> single spaces
--   * a term is a GROUP of variants (English + Dutch); the group matches if any
--     variant does, so a Dutch and an English message weigh the same
--   * drop any variant carried by more than 10% of messages in the window - a
--     word that common distinguishes nothing and would hand the same crowd to
--     every item that happens to use it
--   * drop groups that match nothing, keep at most 6
--   * fewer than 2 usable groups -> NULL, meaning "cannot tell". NOT zero, which
--     would claim nobody asks
--   * a message hits when it matches >= need groups, need = 3 if there are 4+
--     groups else 2. A long title has more generic words in it, so a fixed 2
--     would let its two commonest terms measure the broad subject instead
--
-- Club items match a literal phrase instead ("de Pijp" split into words matches
-- half of Amsterdam), so they carry demand_kind='phrase'.
--
-- IMPORTANT this counts conversations that MENTIONED these words. It is not a
-- record of what retrieval actually returned - nothing logged that until 047.
-- Keep the wording on the page honest about which of the two it is showing.

ALTER TABLE bot.knowledge_items
  ADD COLUMN IF NOT EXISTS demand_kind   text,
  ADD COLUMN IF NOT EXISTS demand_groups text[],
  ADD COLUMN IF NOT EXISTS demand_phrase text;

COMMENT ON COLUMN bot.knowledge_items.demand_kind IS
  'terms | phrase | none - how bot.knowledge_demand() should match this item';
COMMENT ON COLUMN bot.knowledge_items.demand_groups IS
  'One entry per candidate term; each entry is that term''s variants (English + Dutch), pipe-joined and already normalised. Pre-filter: too-common and no-hit groups are dropped per window, not here.';
COMMENT ON COLUMN bot.knowledge_items.demand_phrase IS
  'Normalised literal phrase for demand_kind=phrase (club names).';

-- Normalisation, matching items.js norm() character for character.
CREATE OR REPLACE FUNCTION bot.knowledge_norm(t text)
RETURNS text
LANGUAGE sql IMMUTABLE PARALLEL SAFE
AS $$
  SELECT btrim(regexp_replace(
    lower(translate(coalesce(t, ''),
      'àáâãäåçèéêëìíîïñòóôõöùúûüýÿÀÁÂÃÄÅÇÈÉÊËÌÍÎÏÑÒÓÔÕÖÙÚÛÜÝ',
      'aaaaaaceeeeiiiinooooouuuuyyAAAAAACEEEEIIIINOOOOOUUUUY')),
    '[^a-z0-9]+', ' ', 'g'));
$$;

COMMENT ON FUNCTION bot.knowledge_norm(text) IS
  'lowercase, strip diacritics, collapse everything else to single spaces. Mirrors norm() in tools/knowledge/items.js.';

-- Demand for a window. Returns one row per item that HAS a spec; items with
-- demand_kind='none' are absent, and the caller should read that as "cannot tell"
-- exactly as a NULL matched_sessions does today.
CREATE OR REPLACE FUNCTION bot.knowledge_demand(from_date date, to_date date)
RETURNS TABLE (
  item_key         text,
  matched_messages integer,
  matched_sessions integer,
  demand_terms     text[],
  demand_need      integer,
  total_messages   integer
)
LANGUAGE sql STABLE
AS $$
WITH msgs AS (
  SELECT row_number() OVER (ORDER BY created_at) AS mid,
         session_id,
         bot.knowledge_norm(content) AS t
  FROM bot.conversation_messages
  WHERE role = 'user'
    AND created_at >= from_date
    AND created_at < (to_date + 1)
),
kept AS (SELECT * FROM msgs WHERE t <> ''),
n AS (SELECT count(*)::numeric AS total FROM kept),
-- One row per (message, distinct word). DISTINCT because items.js indexes a
-- Set of the words in each message, so a word repeated in one message counts once.
words AS (
  SELECT DISTINCT k.mid, k.session_id, w.word
  FROM kept k, unnest(string_to_array(k.t, ' ')) AS w(word)
  WHERE w.word <> ''
),
-- "More than a tenth of all member messages" - computed for THIS window.
too_common AS (
  SELECT word FROM words GROUP BY word
  HAVING count(DISTINCT mid) > (SELECT round(total * 0.10) FROM n)
),
-- Explode each item's stored spec into candidate groups, preserving order so
-- "keep at most 6" keeps the same six items.js would have kept.
spec AS (
  SELECT i.key,
         g.ord,
         string_to_array(g.grp, '|') AS variants
  FROM bot.knowledge_items i,
       unnest(coalesce(i.demand_groups, '{}')) WITH ORDINALITY AS g(grp, ord)
  WHERE i.demand_kind = 'terms'
),
-- A group matches a message if ANY of its still-usable variants appears in it.
group_hits AS (
  SELECT s.key, s.ord, w.mid, w.session_id
  FROM spec s
  JOIN words w ON w.word = ANY (
    ARRAY(SELECT v FROM unnest(s.variants) AS v
          WHERE v NOT IN (SELECT word FROM too_common))
  )
  GROUP BY s.key, s.ord, w.mid, w.session_id
),
-- Groups that matched nothing are dropped, then the first 6 are kept.
live_groups AS (
  SELECT key, ord,
         row_number() OVER (PARTITION BY key ORDER BY ord) AS rank
  FROM (SELECT DISTINCT key, ord FROM group_hits) g
),
usable AS (SELECT key, ord FROM live_groups WHERE rank <= 6),
group_count AS (
  SELECT key, count(*)::int AS groups,
         CASE WHEN count(*) >= 4 THEN 3 ELSE 2 END AS need
  FROM usable GROUP BY key
),
-- A message hits when it matched at least `need` of the usable groups.
msg_hits AS (
  SELECT h.key, h.mid, h.session_id
  FROM group_hits h
  JOIN usable u ON u.key = h.key AND u.ord = h.ord
  JOIN group_count c ON c.key = h.key
  GROUP BY h.key, h.mid, h.session_id, c.need
  HAVING count(*) >= c.need
),
-- The surviving terms, reported back so the page can keep showing exactly what
-- was matched on. First variant of each group is the English one items.js kept.
kept_terms AS (
  SELECT u.key, array_agg(split_part(g.grp, '|', 1) ORDER BY g.ord) AS terms
  FROM usable u
  JOIN bot.knowledge_items i2 ON i2.key = u.key
  CROSS JOIN LATERAL unnest(i2.demand_groups) WITH ORDINALITY AS g(grp, ord)
  WHERE g.ord = u.ord
  GROUP BY u.key
),
term_result AS (
  SELECT c.key,
         coalesce(count(m.mid), 0)::int AS matched_messages,
         coalesce(count(DISTINCT m.session_id), 0)::int AS matched_sessions,
         coalesce(max(kt.terms), '{}') AS demand_terms,
         c.need
  FROM group_count c
  LEFT JOIN msg_hits m ON m.key = c.key
  LEFT JOIN kept_terms kt ON kt.key = c.key
  WHERE c.groups >= 2      -- fewer than two usable groups is NO number, not zero
  GROUP BY c.key, c.need
),
-- Club names: whole-phrase, space-padded so "Coolsingel" is not credited to
-- Singel and "Oosterpark" is not credited to Oost. Both happened in the first run.
phrase_result AS (
  SELECT i.key,
         count(*) FILTER (WHERE k.t IS NOT NULL)::int AS matched_messages,
         count(DISTINCT k.session_id)::int AS matched_sessions,
         ARRAY[i.demand_phrase] AS demand_terms,
         NULL::int AS need
  FROM bot.knowledge_items i
  LEFT JOIN kept k
    ON (' ' || k.t || ' ') LIKE ('%' || ' ' || i.demand_phrase || ' ' || '%')
  WHERE i.demand_kind = 'phrase' AND coalesce(i.demand_phrase, '') <> ''
  GROUP BY i.key, i.demand_phrase
)
SELECT key, matched_messages, matched_sessions, demand_terms, need,
       (SELECT total::int FROM n)
FROM term_result
UNION ALL
SELECT key, matched_messages, matched_sessions, demand_terms, need,
       (SELECT total::int FROM n)
FROM phrase_result;
$$;

COMMENT ON FUNCTION bot.knowledge_demand(date, date) IS
  'Conversations MENTIONING each knowledge item in a window. Word matching, not a record of retrieval - see bot.knowledge_reach() for that.';

GRANT EXECUTE ON FUNCTION bot.knowledge_demand(date, date) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION bot.knowledge_norm(text) TO authenticated, service_role;

-- created_at is the only thing this ever filters on, and the table is the
-- busiest in the schema.
CREATE INDEX IF NOT EXISTS conversation_messages_role_created_idx
  ON bot.conversation_messages (role, created_at);
