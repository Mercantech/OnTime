-- Kør én gang hvis din database blev oprettet før is_admin blev tilføjet:
-- docker compose exec db psql -U ontime -d ontime -f - < database/migrations/001_add_admin.sql
-- (eller kør indholdet manuelt i psql)

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'users' AND column_name = 'is_admin') THEN
    ALTER TABLE users ADD COLUMN is_admin BOOLEAN NOT NULL DEFAULT false;
  END IF;
END $$;
