CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('user','admin')),
  must_change_password BOOLEAN NOT NULL DEFAULT FALSE,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email_lower ON users ((lower(email)));

CREATE TABLE IF NOT EXISTS saved_locations (
  id BIGSERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  location_type TEXT NOT NULL DEFAULT 'saved',
  street TEXT NOT NULL,
  number TEXT NOT NULL,
  complement TEXT NOT NULL DEFAULT '',
  neighborhood TEXT NOT NULL,
  city TEXT NOT NULL,
  state TEXT NOT NULL,
  zip_code TEXT NOT NULL DEFAULT '',
  phone TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_saved_locations_name_lower ON saved_locations ((lower(name)));
CREATE INDEX IF NOT EXISTS idx_saved_locations_city_state ON saved_locations(city, state);

CREATE TABLE IF NOT EXISTS geocode_cache (
  address_key TEXT PRIMARY KEY,
  latitude DOUBLE PRECISION NOT NULL,
  longitude DOUBLE PRECISION NOT NULL,
  provider TEXT NOT NULL DEFAULT '',
  quality TEXT NOT NULL DEFAULT 'validated',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_geocode_cache_updated_at ON geocode_cache(updated_at);

CREATE TABLE IF NOT EXISTS app_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS route_history (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title TEXT NOT NULL DEFAULT '',
  origin_json JSONB NOT NULL,
  stops_json JSONB NOT NULL,
  rules_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  final_stop_id TEXT,
  sequence_json JSONB NOT NULL,
  map_links_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  summary_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  provider TEXT NOT NULL DEFAULT '',
  algorithm TEXT NOT NULL DEFAULT '',
  total_distance_meters DOUBLE PRECISION,
  total_duration_seconds DOUBLE PRECISION,
  generated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_route_history_user_generated ON route_history(user_id, generated_at DESC);
CREATE INDEX IF NOT EXISTS idx_route_history_generated ON route_history(generated_at DESC);

CREATE TABLE IF NOT EXISTS appointments (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  notes TEXT NOT NULL DEFAULT '',
  start_at TIMESTAMPTZ NOT NULL,
  end_at TIMESTAMPTZ NOT NULL,
  route_id TEXT REFERENCES route_history(id) ON DELETE SET NULL,
  manual_route_url TEXT NOT NULL DEFAULT '',
  series_id TEXT,
  recurrence_type TEXT NOT NULL DEFAULT 'none' CHECK (recurrence_type IN ('none','daily')),
  recurrence_until DATE,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','cancelled')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (end_at > start_at)
);
CREATE INDEX IF NOT EXISTS idx_appointments_period ON appointments(start_at, end_at) WHERE status = 'active';
CREATE INDEX IF NOT EXISTS idx_appointments_user ON appointments(user_id, start_at DESC);
CREATE INDEX IF NOT EXISTS idx_appointments_series ON appointments(series_id, start_at);

CREATE TABLE IF NOT EXISTS appointment_attachments (
  id TEXT PRIMARY KEY,
  appointment_id TEXT NOT NULL REFERENCES appointments(id) ON DELETE CASCADE,
  blob_path TEXT NOT NULL,
  original_name TEXT NOT NULL,
  content_type TEXT NOT NULL DEFAULT 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  size_bytes BIGINT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_appointment_attachments_appointment ON appointment_attachments(appointment_id);

INSERT INTO saved_locations(name, location_type, street, number, complement, neighborhood, city, state, zip_code, phone, notes)
VALUES
  ('Depósito Bela Metais','saved','Servidão Himmemblau','90','','Costa e Silva','Joinville','SC','89217-795','','Local inicial para partida ou parada'),
  ('Loja Bela Metais Curitiba','store','Avenida dos Estados','1066','','Água Verde','Curitiba','PR','80610-040','','Local inicial do RouteX'),
  ('Loja Bela Metais Joinville','store','Rua Ottokar Doerffel','1735','','Anita Garibaldi','Joinville','SC','89203-307','','Local inicial do RouteX')
ON CONFLICT DO NOTHING;

INSERT INTO geocode_cache(address_key, latitude, longitude, provider, quality)
VALUES ('himmemblau|90|joinville|SC|89217795', -26.2845464, -48.8856213, 'CEP 89217-795 - coordenada validada', 'seeded')
ON CONFLICT (address_key) DO NOTHING;

INSERT INTO app_settings(key,value,updated_at) VALUES ('schema_version','3.0.0',NOW())
ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value, updated_at=NOW();
