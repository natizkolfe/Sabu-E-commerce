-- MIGRATION 018 - seed reference data --------------------------------
INSERT INTO core.currencies (code, name, minor_units) VALUES
  ('ETB','Ethiopian Birr',2), ('AED','UAE Dirham',2), ('USD','US Dollar',2);
INSERT INTO core.operating_regions (code, name, country_code, base_currency, timezone) VALUES
  ('ET','Ethiopia','ET','ETB','Africa/Addis_Ababa'),
  ('AE-DXB','Dubai','AE','AED','Asia/Dubai');
INSERT INTO iam.roles (code, name, is_system) VALUES
  ('super_admin','Super Administrator',true),
  ('et_operations_admin','Ethiopia Operations Administrator',true),
  ('dubai_procurement_admin','Dubai Procurement Administrator',true),
  ('warehouse_manager','Inventory / Warehouse Manager',true),
  ('finance_admin','Finance Administrator',true),
  ('support_agent','Customer Support Agent',true),
  ('logistics_manager','Delivery / Logistics Manager',true),
  ('driver','Driver',true),
  ('retail_customer','Retail Customer',true),
  ('wholesale_customer','Wholesale Customer',true);
-- Providers seeded as 'unverified': none are confirmed integrations.
INSERT INTO payments.payment_providers (code, name, provider_kind, integration_status) VALUES
  ('telebirr','telebirr (Ethio Telecom)','wallet','unverified'),
  ('chapa','Chapa','gateway','unverified'),
  ('cbe','Commercial Bank of Ethiopia','bank','unverified'),
  ('bank_transfer','Manual bank transfer','manual','live'),
  ('cash_on_delivery','Cash on delivery','manual','live');
