# OnTime
Mød nu til tiden! Elev-indstempling med geolokation.

## Kør med Docker (anbefalet)

Databasen kører i Docker – ingen Neon eller ekstern database nødvendig.

```bash
docker compose up --build
```

Åbn http://localhost:3000

### Første gang: opret brugere og admin

Kør seed én gang for at oprette klassen "1a", test-elev **test@test.dk** og admin **admin@ontime.dk**:

```bash
docker compose run --rm app node seed.js
```

- **Elev:** test@test.dk / test123  
- **Admin:** admin@ontime.dk / admin123  

Log ind som admin og gå til **Admin** (i headeren) for at oprette nye klasser og brugere med egne adgangskoder.

### Eksisterende database uden admin?

Hvis databasen blev oprettet før admin-funktionen, kør migrationen én gang:

```bash
docker compose exec db psql -U ontime -d ontime -c "DO \$\$ BEGIN IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'users' AND column_name = 'is_admin') THEN ALTER TABLE users ADD COLUMN is_admin BOOLEAN NOT NULL DEFAULT false; END IF; END \$\$;"
```

Kør derefter seed igen for at oprette admin-brugeren.

## Miljøvariabler

- `DATABASE_URL` – sættes automatisk i Docker
- `JWT_SECRET` – sæt i produktion
- `SPOTIFY_CLIENT_ID` og `SPOTIFY_CLIENT_SECRET` – til Sangønsker-siden (søg efter sange). Opret en app på [Spotify for Developers](https://developer.spotify.com/dashboard) og brug Client Credentials. Uden disse virker resten af appen; kun søgning på Sangønsker vil vise en fejl.
- `ALLOWED_RADIUS_METERS` – radius i meter for indstempling (standard 2000). Øg fx til 2500 hvis skolens netværk giver forkert GPS.

## Lokal udvikling uden Docker

1. Kør Postgres lokalt og opret database `ontime`, kør `database/init.sql`.
2. `cd backend && npm install && DATABASE_URL=postgresql://... node seed.js` (én gang).
3. `DATABASE_URL=... npm run dev` og åbn frontend via backend (fx http://localhost:3000).
