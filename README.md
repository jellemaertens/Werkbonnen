# Werkbonnen-app

Een web-app om werkbonnen in te vullen bij de klant en ter plaatse te laten ondertekenen. Ze werkt op tablet, smartphone en pc, ook zonder internetverbinding.

De app en de afgedrukte werkbon volgen de BOSS paints-huisstijl: het primaire groene palet, het lettertype Mona Sans (stylistische set 3) en het officiële logo. Logo en lettertype zitten in `assets/`, zodat ze ook offline werken. De bedrijfsgegevens onderaan de werkbon pas je aan in **Instellingen**.

## Wat kan de app?

- **Klant kiezen** uit de klantenlijst (met zoekfunctie), of ter plaatse een nieuwe klant aanmaken.
- **Machine kiezen** bij die klant (model, fabrikant, serienummer), of een nieuwe machine toevoegen.
- **Bezoek**: datum, start- en eindtijd, monteur, type interventie, referentie/PO van de klant.
- **Uitgevoerde werken**: melding, bevindingen en werkzaamheden, met knoppen voor vaak gebruikte zinnen.
- **Onderdelen** uit de onderdelenlijst toevoegen (zoeken op artikelnummer of omschrijving), of als vrije regel.
- **Werkuren**: worden automatisch berekend uit start- en eindtijd (per kwartier). Je kunt ze ook zelf aanpassen.
- **Aanrijkost, brandstoftoeslag** en extra kosten. Totalen met en zonder BTW.
- **Handtekening van de klant** met vinger of pen. Na het ondertekenen ligt de werkbon vast. Is de klant er niet? Dan rond je af met een reden ("Klant niet aanwezig").
- **PDF / afdrukken**: kies in het printvenster "Opslaan als PDF" en mail de PDF naar de klant.
- **Export (CSV)** van alle werkbonnen, één regel per artikel/prestatie, klaar voor de facturatie.

De klanten, machines en onderdelen zijn bij de eerste start ingeladen uit `Eskens_servicebezoeken.xlsx` en de kostenbladen. Je kunt ze aanvullen via **Klanten** en **Onderdelen**, of een CSV importeren (bv. een export uit het ERP-pakket, in Excel opgeslagen als CSV).

**Startgegevens en privacy:** `data/seed.js` in deze repository is bewust leeg. De echte startgegevens (klantnamen, adressen, contactpersonen, e-mailadressen, monteurs en onderdelenprijzen) staan in `data/seed.local.js`. Dat bestand staat in `.gitignore` en komt dus nooit op GitHub. Bestaat het, dan laadt de app het automatisch in plaats van de lege seed. Op een server zonder dat bestand start de app leeg; vul klanten en onderdelen dan aan via CSV-import of de centrale database.

## Eerste keer instellen (per toestel)

1. **Aanmelden**: bij de eerste start kiest de monteur zijn naam uit de keuzelijst (en vult hij eenmalig de **teamcode** in die hij van kantoor krijgt). Via de naam rechtsboven kan je later van monteur wisselen.
2. **Voorvoegsel werkbonnummer**: komt automatisch van de gekozen monteur (bv. `TD` geeft `TD-2026-0001`). Zo botsen nummers van verschillende monteurs nooit. Je kunt het aanpassen in **Instellingen**.
3. **Bedrijfsgegevens en logo**: deze komen bovenaan op de werkbon.
4. **Tarieven**: uurtarief, aanrijkost, brandstoftoeslag en BTW.

## Starten op deze pc

```
powershell -ExecutionPolicy Bypass -File serve.ps1
```

Open daarna http://localhost:8080 in Chrome of Edge.

## In gebruik nemen op tablets en smartphones

De app is een set statische bestanden (HTML, CSS en JavaScript), zonder server-logica. Zet de map `werkbon-app` op een **https**-webadres, bv. Azure Static Web Apps, een interne webserver of een andere statische hosting. Open dat adres op de tablet en kies **Toevoegen aan beginscherm** of **App installeren**. Daarna werkt de app ook offline.

## Waar staan de gegevens? (centrale database)

De app werkt **offline eerst**: alles wordt op het toestel bewaard (in de browser), zodat de monteur ook zonder netwerk verder kan. Is er een centrale database ingesteld, dan:

- gaat elke werkbon (ook concepten, met de handtekening van de klant) naar de centrale database **zodra het toestel online is**. Wat nog niet verzonden is, staat in een wachtrij op het toestel en blijft daar tot de server het heeft aangenomen. Rechtsboven zie je de status: `✓ 14:05` (alles verzonden), `↑ 2` (2 wijzigingen te verzenden), `Offline · 2` of `⚠` (fout, bv. verkeerde teamcode);
- komen **klanten, machines, onderdelen en monteurs** van de centrale database. Wijzigingen die iemand anders maakt, verschijnen binnen een minuut op elk toestel dat online is (of meteen bij het openen van de app). Een klant die een monteur ter plaatse aanmaakt, gaat ook naar de centrale lijst;
- zie je per werkbon van welke monteur hij komt (`monteur` en `gewijzigd_door` in de database).

Synchroniseren gebeurt wanneer de app open staat. Een werkbon die offline gemaakt is, wordt verzonden van zodra de app weer open is met netwerk.

Bij een conflict (twee mensen wijzigen dezelfde klant terwijl ze offline zijn) wint de laatst verzonden versie.

### Beheer (kantoor)

De pagina **Beheer** toont:

- **Werkbonnen van alle monteurs**, zoals ze binnengekomen zijn. Klik op een werkbon om hem af te drukken of als PDF op te slaan. **Exporteren (CSV)** geeft dezelfde export als op het toestel, maar voor alle monteurs.
- **Monteurs**: naam, voorvoegsel voor het werkbonnummer, beheerder ja/nee, actief ja/nee. Enkel actieve monteurs staan in de keuzelijst bij het aanmelden.
- **Lijsten van dit toestel uploaden**: vult een lege centrale database met de monteurs, klanten, machines en onderdelen van dit toestel (de startgegevens uit `Eskens_servicebezoeken.xlsx`). Doe dit één keer, vanaf één toestel.

Klanten en onderdelen beheer je gewoon via **Klanten** en **Onderdelen** (ook CSV-import): elke wijziging gaat naar de centrale database.

Zolang er geen enkele beheerder aangeduid is, ziet iedereen de pagina Beheer. Duid dus eerst jezelf aan als beheerder.

### Veiligheid: lees dit even

- De monteur kiest zijn naam uit een lijst, zonder wachtwoord. Dat is **geen echte identificatie**: een monteur kan een andere naam kiezen. Wil je dat wel afdwingen, dan is de volgende stap aanmelden met het Microsoft 365-account (Supabase Auth met Azure/Entra ID).
- De publieke sleutel in `js/config.js` is zichtbaar voor iedereen die de app opent. De **teamcode** beschermt de gegevens: zonder juiste teamcode geeft de database niets terug en aanvaardt ze niets (row-level security). Hou de teamcode dus binnen het team en verander ze als een toestel verloren gaat.
- De pagina Beheer verbergen voor niet-beheerders is gemak, geen beveiliging: wie de teamcode heeft, kan alle gegevens lezen.

## Centrale database opzetten (Lovable Cloud / Supabase)

1. **Database aanmaken.** Open het project in Lovable met **Lovable Cloud** aan (dat is een Supabase-database). Laat de SQL uit `supabase/migrations/001_werkbon_centraal.sql` uitvoeren: vraag het in de Lovable-chat ("voer deze migratie uit") of plak ze in de SQL-editor van Supabase. Dit maakt de tabellen `monteurs`, `klanten`, `machines`, `onderdelen` en `werkbonnen` aan, met de beveiliging via de teamcode.
2. **Teamcode kiezen.** Voer uit (met je eigen code):
   ```sql
   update public.werkbon_config set waarde = 'jouw-geheime-teamcode' where sleutel = 'teamcode';
   ```
3. **App koppelen.** Vul in `js/config.js` de **Project URL** en de **anon/publishable key** in (Lovable: Cloud-instellingen, Supabase: Project Settings › API). Dan moeten de toestellen enkel nog de teamcode invullen. Je kunt URL en sleutel ook per toestel invullen bij **Instellingen › Centrale database**.
4. **App online zetten.** De app blijft een set statische bestanden. In een Lovable-project zet je de inhoud van `werkbon-app` in de map `public/`, zodat ze ongewijzigd geserveerd wordt. Je kunt ze ook op een andere https-hosting zetten en Lovable Cloud enkel als database gebruiken.
5. **Vullen.** Open de app op één toestel, meld je aan, ga naar **Beheer** en klik **Lijsten van dit toestel uploaden**. Duid jezelf aan als beheerder en controleer de voorvoegsels van de monteurs.
6. **Toestellen.** Open de app op elke tablet, kies de monteur, vul de teamcode in. Bij **Instellingen › Centrale database** kan je met **Verbinding testen** nagaan of alles klopt.

Getest met de test-API hieronder. De koppeling met een echt Lovable Cloud-project (inclusief de headers voor de teamcode) is nog niet getest.

### De database bekijken

In de tabel `werkbonnen` staat de volledige werkbon als JSON in de kolom `data`. Voor overzichten zijn er ook gewone kolommen: `nummer`, `datum`, `status`, `monteur`, `klant_naam`, `gewijzigd_door` en `bijgewerkt_op` (tijdstip van ontvangst). Verwijderde records krijgen `verwijderd = true`, zodat ook andere toestellen ze kunnen wissen.

## Lokaal testen met een test-database

`serve.ps1 -Api` doet na wat Supabase doet (dezelfde REST-adressen, teamcode, wachtrij), met de gegevens als JSON-bestanden in de map `werkbon-centraal-test` naast `werkbon-app`. Enkel om te testen; je mag die map gerust wissen.

```bash
powershell -ExecutionPolicy Bypass -File serve.ps1 -Port 8090 -Api -TeamCode test
```

```bash
powershell -ExecutionPolicy Bypass -File serve.ps1 -Port 8091
```

Open http://localhost:8090 en http://localhost:8091: dat zijn twee "toestellen" met elk hun eigen opslag. Vul in beide bij **Instellingen › Centrale database** als URL `http://localhost:8090`, een willekeurige sleutel en teamcode `test` in. Stop de eerste server om "offline" te testen: werkbonnen blijven in de wachtrij en worden verzonden zodra de server weer draait.

## Bestanden

| Bestand | Inhoud |
|---|---|
| `index.html` | Startpagina van de app |
| `js/app.js` | Schermen en logica (werkbonnen, klanten, onderdelen, instellingen) |
| `js/print.js` | Opmaak van de afgedrukte werkbon / PDF |
| `js/signature.js` | Handtekeningveld |
| `js/db.js` | Opslag op het toestel (IndexedDB), inclusief de wachtrij (`outbox`) |
| `js/sync.js` | Synchronisatie met de centrale database: wachtrij verzenden, lijsten ophalen |
| `js/config.js` | Adres en publieke sleutel van de centrale database |
| `supabase/migrations/001_werkbon_centraal.sql` | Tabellen en beveiliging van de centrale database |
| `data/seed.js` | Startgegevens: klanten, machines, onderdelen, monteurs |
| `sw.js` | Offline werking |
| `serve.ps1` | Kleine webserver om lokaal te testen (met `-Api` ook een test-database) |
