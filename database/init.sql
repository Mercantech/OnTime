-- OnTime - Elev indstempling
-- Kører automatisk ved opstart af Postgres i Docker (docker-entrypoint-initdb.d)

CREATE TABLE IF NOT EXISTS classes (
  id   SERIAL PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS users (
  id         SERIAL PRIMARY KEY,
  class_id   INT NOT NULL REFERENCES classes(id),
  email      TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  name       TEXT NOT NULL,
  is_admin   BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS check_ins (
  id          SERIAL PRIMARY KEY,
  user_id     INT NOT NULL REFERENCES users(id),
  check_date  DATE NOT NULL,
  checked_at  TIMESTAMPTZ NOT NULL,
  points      INT NOT NULL CHECK (points >= 0 AND points <= 45),
  lat         DOUBLE PRECISION,
  lng         DOUBLE PRECISION,
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (user_id, check_date)
);

CREATE INDEX idx_check_ins_checked_at ON check_ins (checked_at);
CREATE INDEX idx_users_class ON users (class_id);

-- Skoleadresse: H. C. Andersens Vej 9, 8800 Viborg (koordinater til validering)
-- Radius ~150m accepteres (konfigureres i backend)

COMMENT ON TABLE check_ins IS 'Én indstempling per bruger per kalenderdag';
