// Startgegevens voor een nieuw toestel. Deze versie is bewust leeg: echte klant- en
// onderdelengegevens horen niet in een publieke repository.
// - Lokaal: zet je eigen startgegevens in data/seed.local.js (staat in .gitignore).
//   Dat bestand overschrijft window.SEED.
// - Anders: importeer klanten en onderdelen via CSV, of gebruik de centrale database.
window.SEED = {
  klanten: [],
  machines: [],
  onderdelen: [],
  monteurs: [],
  interventietypes: ['Gebruikersfout', 'Installatie', 'Interventie', 'Onderhoud', 'Pasta-gerelateerd', 'Storing'],
};
