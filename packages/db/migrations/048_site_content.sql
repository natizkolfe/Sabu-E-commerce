-- MIGRATION 048 — customer-facing site content (About Sabu, contact, FAQs)
-- Editable from admin without redeploying the storefront.

CREATE TABLE IF NOT EXISTS core.site_content (
  key TEXT PRIMARY KEY,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by UUID REFERENCES iam.users (id)
);

COMMENT ON TABLE core.site_content IS
  'Keyed JSON blobs for public storefront pages (about, contact, FAQs).';

INSERT INTO iam.permissions (code, module, description) VALUES
  ('core.site_content.write', 'core', 'Edit public About/contact/FAQ content')
ON CONFLICT (code) DO NOTHING;

INSERT INTO iam.role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM iam.roles r
CROSS JOIN iam.permissions p
WHERE r.code IN ('et_operations_admin', 'super_admin')
  AND p.code = 'core.site_content.write'
ON CONFLICT DO NOTHING;

INSERT INTO core.site_content (key, payload)
VALUES (
  'about',
  jsonb_build_object(
    'headline', 'About Sabu',
    'intro',
      'Sabu Online Shopping brings everyday products to your door across Ethiopia — local stock, bulk rates, and special orders when you need something we do not carry yet.',
    'phone', '+251911129726',
    'whatsappUrl', 'https://wa.me/251911129726',
    'instagramUrl', 'https://instagram.com/sabu_placeholder',
    'tiktokUrl', 'https://tiktok.com/@sabu_placeholder',
    'facebookUrl', 'https://facebook.com/sabu_placeholder',
    'contactNote',
      'Questions or issues? Call or message us, or reach out on social media. Replace the Instagram, TikTok, and Facebook links in Admin when your pages are ready.',
    'faqs',
      jsonb_build_array(
        jsonb_build_object(
          'question', 'How is the delivery fee calculated?',
          'answer',
            'Delivery is based on distance from our dispatch point: a base fare plus a per-kilometre rate. You see the exact fee at checkout after you pin your delivery location. Express (when enabled) uses a higher rate for faster delivery.'
        ),
        jsonb_build_object(
          'question', 'Where do you deliver?',
          'answer',
            'We currently focus on Addis Ababa and nearby areas covered by our delivery zones. If your pin is outside the service area, checkout will explain and you can contact us for help.'
        ),
        jsonb_build_object(
          'question', 'How do I track my order?',
          'answer',
            'Use Track Order with your order number and the phone number used at checkout. No account is required for guest orders.'
        ),
        jsonb_build_object(
          'question', 'What if I have a problem with my order?',
          'answer',
            'Call or WhatsApp us on the phone number on this page. Have your order number ready so we can help quickly.'
        ),
        jsonb_build_object(
          'question', 'What are Special Orders?',
          'answer',
            'If an item is not in our catalog, submit a Special Order (for example Dubai, China, or USA sourcing). Our team reviews the request and contacts you with next steps — it is separate from regular checkout.'
        ),
        jsonb_build_object(
          'question', 'How do I pay?',
          'answer',
            'At checkout you choose the payment option shown for your order (for example Telebirr or bank transfer). Follow the on-screen instructions and keep your order number for tracking.'
        )
      )
  )
)
ON CONFLICT (key) DO NOTHING;
