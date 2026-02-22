/**
 * Henter hovedstæder fra RestCountries API og tilføjer dem til backend/data/countries.json.
 * Kør: node backend/scripts/enrich-countries-with-capitals.js
 */
const fs = require('fs');
const path = require('path');

const countriesPath = path.join(__dirname, '..', 'data', 'countries.json');
const url = 'https://restcountries.com/v3.1/all?fields=cca2,capital';

async function main() {
  const raw = fs.readFileSync(countriesPath, 'utf8');
  const countries = JSON.parse(raw);

  const res = await fetch(url);
  if (!res.ok) throw new Error('RestCountries API fejl: ' + res.status);
  const apiList = await res.json();

  const capitalByCode = {};
  for (const c of apiList) {
    const code = (c.cca2 || '').toLowerCase();
    const cap = Array.isArray(c.capital) && c.capital.length ? c.capital[0] : null;
    capitalByCode[code] = cap;
  }

  for (const c of countries) {
    c.capital = capitalByCode[c.code] || null;
  }

  fs.writeFileSync(countriesPath, JSON.stringify(countries, null, 2), 'utf8');
  const withCapital = countries.filter((c) => c.capital).length;
  console.log('Opdateret ' + countries.length + ' lande. ' + withCapital + ' har hovedstad.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
