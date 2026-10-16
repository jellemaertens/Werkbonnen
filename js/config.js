// Centrale database (Supabase). Staat UIT: elk toestel bewaart zijn eigen gegevens,
// werkbonnen gaan naar kantoor via PDF en CSV-export.
// - centraal: false  -> geen centrale database, ook niet als er in Instellingen iets ingevuld is.
// - Later opnieuw aanzetten: centraal: true, en de project-URL en de publieke (anon/publishable)
//   sleutel invullen. De teamcode staat bewust NIET hier: elk toestel vult die eenmalig in.
window.WERKBON_CONFIG = {
  centraal: false,
  supabaseUrl: '',
  supabaseKey: '',
};
