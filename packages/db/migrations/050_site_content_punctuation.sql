-- MIGRATION 050: replace em dashes in About Sabu copy with normal punctuation

UPDATE core.site_content
SET
  payload = jsonb_set(
    jsonb_set(
      payload,
      '{intro}',
      to_jsonb(
        'Sabu Online Shopping brings everyday products to your door across Ethiopia: local stock, bulk rates, and special orders when you need something we do not carry yet.'::text
      )
    ),
    '{faqs}',
    COALESCE(
      (
        SELECT jsonb_agg(
          CASE
            WHEN elem->>'question' = 'What are Special Orders?' THEN
              jsonb_set(
                elem,
                '{answer}',
                to_jsonb(
                  'If an item is not in our catalog, submit a Special Order (for example Dubai, China, or USA sourcing). Our team reviews the request and contacts you with next steps. It is separate from regular checkout.'::text
                )
              )
            ELSE elem
          END
        )
        FROM jsonb_array_elements(payload->'faqs') AS elem
      ),
      payload->'faqs'
    )
  ),
  updated_at = now()
WHERE key = 'about';
