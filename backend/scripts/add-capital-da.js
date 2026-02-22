/**
 * Tilføjer capital_da (danske hovedstadnavne) til backend/data/countries.json.
 * Samme mønster som name_da for lande. Kør: node backend/scripts/add-capital-da.js
 */
const fs = require('fs');
const path = require('path');

const countriesPath = path.join(__dirname, '..', 'data', 'countries.json');

/** Engelsk hovedstad -> dansk navn (hvor det afviger). Kilde: dansk sprogbrug / Den Store Danske. */
const CAPITAL_DA = {
  'Algiers': 'Alger',
  'Athens': 'Athen',
  'Beijing': 'Peking',
  'Brussels': 'Brussel',
  'Bucharest': 'Bukarest',
  'Budapest': 'Budapest',
  'Cairo': 'Kairo',
  'Canberra': 'Canberra',
  'City of Victoria': 'Victoria',
  'Copenhagen': 'København',
  'Guatemala City': 'Guatemala',
  'Havana': 'Havanna',
  'Helsinki': 'Helsingfors',
  'Jerusalem': 'Jerusalem',
  'Kyiv': 'Kijev',
  'Lisbon': 'Lissabon',
  'Mexico City': 'Mexico City',
  'Moscow': 'Moskva',
  'New Delhi': 'New Delhi',
  'N\'Djamena': 'N\'Djamena',
  'Panama City': 'Panama by',
  'Prague': 'Prag',
  'Rome': 'Rom',
  'San José': 'San José',
  'Seoul': 'Seoul',
  'Sri Jayawardenepura Kotte': 'Sri Jayewardenepura Kotte',
  'Taipei': 'Taipei',
  'Tbilisi': 'Tbilisi',
  'Vienna': 'Wien',
  'Warsaw': 'Warszawa',
  'Washington, D.C.': 'Washington',
  'Yaoundé': 'Yaoundé',
};

function main() {
  const raw = fs.readFileSync(countriesPath, 'utf8');
  const countries = JSON.parse(raw);

  for (const c of countries) {
    if (c.capital) {
      c.capital_da = CAPITAL_DA[c.capital] ?? c.capital;
    } else {
      c.capital_da = null;
    }
  }

  fs.writeFileSync(countriesPath, JSON.stringify(countries, null, 2), 'utf8');
  const withDa = countries.filter((c) => c.capital_da && c.capital_da !== c.capital).length;
  console.log('Tilføjet capital_da til ' + countries.length + ' lande. ' + withDa + ' har afvigende dansk form.');
}

main();
