require('dotenv').config();
const bcrypt = require('bcrypt');
const { pool } = require('./db');

async function seed() {
  await pool.query(
    "INSERT INTO classes (name) VALUES ('1a') ON CONFLICT (name) DO NOTHING"
  );
  const testHash = await bcrypt.hash('test123', 10);
  await pool.query(
    `INSERT INTO users (class_id, email, password_hash, name)
     SELECT c.id, 'test@test.dk', $1, 'Test Elev'
     FROM classes c WHERE c.name = '1a'
     ON CONFLICT (email) DO NOTHING`,
    [testHash]
  );
  const adminHash = await bcrypt.hash('admin123', 10);
  await pool.query(
    `INSERT INTO users (class_id, email, password_hash, name, is_admin)
     SELECT c.id, 'admin@ontime.dk', $1, 'Administrator', true
     FROM classes c WHERE c.name = '1a'
     ON CONFLICT (email) DO UPDATE SET password_hash = EXCLUDED.password_hash, name = EXCLUDED.name, is_admin = true`,
    [adminHash]
  );
  const magsHash = await bcrypt.hash('Cisco123!', 10);
  await pool.query(
    `INSERT INTO users (class_id, email, password_hash, name, is_admin)
     SELECT c.id, 'mags@mercantec.dk', $1, 'MAGS Admin', true
     FROM classes c WHERE c.name = '1a'
     ON CONFLICT (email) DO UPDATE SET password_hash = EXCLUDED.password_hash, name = EXCLUDED.name, is_admin = true`,
    [magsHash]
  );
  console.log('Seed færdig.');
  console.log('  Elev: test@test.dk / test123');
  console.log('  Admin: admin@ontime.dk / admin123');
  console.log('  Admin: mags@mercantec.dk / Cisco123!');
  process.exit(0);
}

seed().catch((e) => {
  console.error(e);
  process.exit(1);
});
