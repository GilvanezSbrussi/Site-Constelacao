ALTER TABLE gallery_items
  ADD COLUMN gallery_name VARCHAR(120) NOT NULL DEFAULT 'Galeria geral';

CREATE INDEX gallery_items_active_name_created
  ON gallery_items (active, gallery_name, created_at DESC);
