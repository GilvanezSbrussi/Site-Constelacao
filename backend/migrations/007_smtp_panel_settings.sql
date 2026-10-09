INSERT INTO site_settings (key, value) VALUES
    ('smtp_enabled', 'false'::jsonb),
    ('smtp_host', '""'::jsonb),
    ('smtp_port', '587'::jsonb),
    ('smtp_secure', 'false'::jsonb),
    ('smtp_user', '""'::jsonb),
    ('smtp_from', '""'::jsonb),
    ('smtp_password_encrypted', '""'::jsonb)
ON CONFLICT (key) DO NOTHING;
