-- MIGRATION 049 — set live Instagram / TikTok links on About Sabu content

UPDATE core.site_content
SET payload = jsonb_set(
      jsonb_set(
        payload,
        '{instagramUrl}',
        '"https://www.instagram.com/sabusonlineshop/"'::jsonb,
        true
      ),
      '{tiktokUrl}',
      '"https://www.tiktok.com/@sabuonlineshope?lang=en"'::jsonb,
      true
    ),
    updated_at = now()
WHERE key = 'about';
