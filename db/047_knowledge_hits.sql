-- 047: record what retrieval ACTUALLY returned, so "reach" stops being a guess.
--
-- /knows has always carried a disclaimer: nothing logs which answer was used, so
-- how often an article actually answered someone cannot be measured, only
-- estimated from the words in member messages (046 makes that estimate live for
-- any window; it does not make it a different kind of number).
--
-- This closes it. The FAQ Search node in Bot - Q&A / Intent Router is a Supabase
-- vector store in retrieve-as-tool mode, and the function it calls is OURS
-- (match_<brand>_faqs). So the retrieval itself can write down what it handed
-- back, with no change to how the answer is produced.
--
-- WHY A NEW FUNCTION RATHER THAN EDITING THE OLD ONE
-- match_trainmore_faqs is on the live answering path for every FAQ question at
-- every club. A mistake in it breaks all of them. So the original is left
-- untouched and a *_logged twin is added alongside; n8n's queryName parameter
-- picks which one runs, and reverting is a one-word edit in the node rather than
-- a migration.
--
-- HOW THE SESSION ID GETS IN
-- The node passes options.metadata through as the `filter` jsonb, which the
-- match function normally uses for `metadata @> filter`. A reserved `_session`
-- key is pulled out and REMOVED before that comparison — leave it in and the
-- containment test matches nothing, because no document has a _session field.
-- If it is absent (anything still calling the old way) the search still works
-- and simply logs nothing.

CREATE TABLE IF NOT EXISTS bot.knowledge_hits (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  session_id  uuid,
  brand       text NOT NULL,
  doc_id      uuid NOT NULL,
  item_key    text,
  title       text,
  similarity  double precision,
  rank        integer,
  created_at  timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE bot.knowledge_hits IS
  'One row per document returned by a FAQ retrieval, written by match_<brand>_faqs_logged. This is what was RETRIEVED, which is still not proof it was used in the reply — the agent may retrieve and then not quote. It is a floor on reach, and a much tighter one than word matching.';
COMMENT ON COLUMN bot.knowledge_hits.item_key IS
  'bot.knowledge_items.key for the article this chunk belongs to, so hits join to the register.';
COMMENT ON COLUMN bot.knowledge_hits.rank IS
  '1 = closest match. topK is 8, so rank 8 was a long way down the list.';

CREATE INDEX IF NOT EXISTS knowledge_hits_created_idx ON bot.knowledge_hits (created_at);
CREATE INDEX IF NOT EXISTS knowledge_hits_item_idx    ON bot.knowledge_hits (item_key, created_at);
CREATE INDEX IF NOT EXISTS knowledge_hits_session_idx ON bot.knowledge_hits (session_id);

-- The same key tools/knowledge/items.js builds, so a hit joins to the register
-- without a second mapping to keep in step: the feed name, then the Freshdesk
-- article id out of reference_url, falling back to a slug of the title.
CREATE OR REPLACE FUNCTION bot.knowledge_item_key(metadata jsonb)
RETURNS text
LANGUAGE sql IMMUTABLE
AS $$
  SELECT coalesce(metadata->>'source', 'unknown') || ':' ||
         coalesce(
           (regexp_match(coalesce(metadata->>'reference_url', ''), '(\d{6,})'))[1],
           't:' || replace(bot.knowledge_norm(coalesce(metadata->>'title', '')), ' ', '-')
         );
$$;

-- Reach for a window: conversations in which each item was actually retrieved.
CREATE OR REPLACE FUNCTION bot.knowledge_reach(from_date date, to_date date)
RETURNS TABLE (
  item_key      text,
  hits          integer,
  sessions      integer,
  top_hits      integer,
  last_seen     timestamptz
)
LANGUAGE sql STABLE
AS $$
  SELECT h.item_key,
         count(*)::int,
         count(DISTINCT h.session_id)::int,
         count(*) FILTER (WHERE h.rank = 1)::int,
         max(h.created_at)
  FROM bot.knowledge_hits h
  WHERE h.created_at >= from_date
    AND h.created_at < (to_date + 1)
    AND h.item_key IS NOT NULL
  GROUP BY h.item_key;
$$;

COMMENT ON FUNCTION bot.knowledge_reach(date, date) IS
  'Conversations in which each item was RETRIEVED, from bot.knowledge_hits. Empty before 15 Sep 2026 — there is no history, logging starts the day it ships.';

GRANT EXECUTE ON FUNCTION bot.knowledge_reach(date, date) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION bot.knowledge_item_key(jsonb) TO authenticated, service_role;

-- The logged twins. Body is identical to the originals apart from stripping
-- _session and writing the hits; the SELECT that decides what comes back is
-- character for character the same, deliberately.
CREATE OR REPLACE FUNCTION public.match_trainmore_faqs_logged(
  query_embedding vector, match_count integer DEFAULT 5, filter jsonb DEFAULT '{}'::jsonb)
RETURNS TABLE(id uuid, content text, metadata jsonb, similarity double precision)
LANGUAGE plpgsql
AS $function$
DECLARE
  sess uuid := nullif(filter->>'_session', '')::uuid;
  real_filter jsonb := filter - '_session';
BEGIN
  RETURN QUERY
  WITH hits AS (
    SELECT fc.id, fc.content, fc.metadata,
           1 - (fc.embedding <=> query_embedding) AS similarity
    FROM public.trainmore_faqs fc
    WHERE fc.metadata @> real_filter
    ORDER BY fc.embedding <=> query_embedding
    LIMIT match_count
  ),
  ranked AS (
    SELECT h.*, row_number() OVER (ORDER BY h.similarity DESC) AS rnk FROM hits h
  ),
  logged AS (
    INSERT INTO bot.knowledge_hits
      (session_id, brand, doc_id, item_key, title, similarity, rank)
    SELECT sess, 'trainmore', r.id, bot.knowledge_item_key(r.metadata),
           r.metadata->>'title', r.similarity, r.rnk
    FROM ranked r
    WHERE sess IS NOT NULL
    RETURNING 1
  )
  SELECT r.id, r.content, r.metadata, r.similarity FROM ranked r ORDER BY r.rnk;
END;
$function$;

CREATE OR REPLACE FUNCTION public.match_gymbox_faqs_logged(
  query_embedding vector, match_count integer DEFAULT 5, filter jsonb DEFAULT '{}'::jsonb)
RETURNS TABLE(id uuid, content text, metadata jsonb, similarity double precision)
LANGUAGE plpgsql
AS $function$
DECLARE
  sess uuid := nullif(filter->>'_session', '')::uuid;
  real_filter jsonb := filter - '_session';
BEGIN
  RETURN QUERY
  WITH hits AS (
    SELECT fc.id, fc.content, fc.metadata,
           1 - (fc.embedding <=> query_embedding) AS similarity
    FROM public.gymbox_faqs fc
    WHERE fc.metadata @> real_filter
    ORDER BY fc.embedding <=> query_embedding
    LIMIT match_count
  ),
  ranked AS (
    SELECT h.*, row_number() OVER (ORDER BY h.similarity DESC) AS rnk FROM hits h
  ),
  logged AS (
    INSERT INTO bot.knowledge_hits
      (session_id, brand, doc_id, item_key, title, similarity, rank)
    SELECT sess, 'gymbox', r.id, bot.knowledge_item_key(r.metadata),
           r.metadata->>'title', r.similarity, r.rnk
    FROM ranked r
    WHERE sess IS NOT NULL
    RETURNING 1
  )
  SELECT r.id, r.content, r.metadata, r.similarity FROM ranked r ORDER BY r.rnk;
END;
$function$;

CREATE OR REPLACE FUNCTION public.match_clubsportive_faqs_logged(
  query_embedding vector, match_count integer DEFAULT 5, filter jsonb DEFAULT '{}'::jsonb)
RETURNS TABLE(id uuid, content text, metadata jsonb, similarity double precision)
LANGUAGE plpgsql
AS $function$
DECLARE
  sess uuid := nullif(filter->>'_session', '')::uuid;
  real_filter jsonb := filter - '_session';
BEGIN
  RETURN QUERY
  WITH hits AS (
    SELECT fc.id, fc.content, fc.metadata,
           1 - (fc.embedding <=> query_embedding) AS similarity
    FROM public.clubsportive_faqs fc
    WHERE fc.metadata @> real_filter
    ORDER BY fc.embedding <=> query_embedding
    LIMIT match_count
  ),
  ranked AS (
    SELECT h.*, row_number() OVER (ORDER BY h.similarity DESC) AS rnk FROM hits h
  ),
  logged AS (
    INSERT INTO bot.knowledge_hits
      (session_id, brand, doc_id, item_key, title, similarity, rank)
    SELECT sess, 'clubsportive', r.id, bot.knowledge_item_key(r.metadata),
           r.metadata->>'title', r.similarity, r.rnk
    FROM ranked r
    WHERE sess IS NOT NULL
    RETURNING 1
  )
  SELECT r.id, r.content, r.metadata, r.similarity FROM ranked r ORDER BY r.rnk;
END;
$function$;
