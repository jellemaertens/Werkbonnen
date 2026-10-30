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

**Startgegevens en privacy:** `data/seed.js` in deze repository is bewust leeg. De echte startgegevens (klantnamen, adressen, contactpersonen, e-mailadressen, monteurs en onderdelenprijzen) staan in `data/seed.local.js`. Dat bestand staat in `.gitignore` en komt dus nooit op GitHub. Bestaat het, dan laadt de app het automatisch in plaats van de lege seed. Op een server zonder dat bestand (zoals GitHub Pages) start de app leeg. Laad de klanten, machines en monteurs dan eenmalig per toestel via **Instellingen › Startgegevens uit bestand**: kies daar het bestand `seed.local.js` (bv. vanuit OneDrive of een mail). Werkbonnen op het toestel blijven daarbij behouden.

## Eerste keer instellen (per toestel)

1. **Aanmelden**: bij de eerste start kies je je naam (of typ je hem, als er nog geen monteurs zijn). Via de naam rechtsboven kan je later van monteur wisselen.
2. **Startgegevens**: op een nieuw toestel zonder `seed.local.js`: **Instellingen › Startgegevens uit bestand** en kies `seed.local.js`.
3. **Voorvoegsel werkbonnummer**: komt automatisch van de gekozen monteur (bv. `TDG` geeft `TDG-2026-0004`). Alle monteurs delen één nummerreeks; je kunt je voorvoegsel aanpassen in **Instellingen**.
4. **Bedrijfsgegevens en logo**: deze komen bovenaan op de werkbon.
5. **Tarieven**: uurtarief, aanrijkost, brandstoftoeslag en BTW.

## Starten op deze pc

```
powershell -ExecutionPolicy Bypass -File serve.ps1
```

Open daarna http://localhost:8080 in Chrome of Edge.

## In gebruik nemen op tablets en smartphones (GitHub Pages)

De app is een set statische bestanden (HTML, CSS en JavaScript), zonder server-logica. GitHub Pages zet ze gratis op een https-adres:

1. Ga op GitHub naar de repository **Werkbonnen** › **Settings** › **Pages**.
2. Kies bij **Source**: *Deploy from a branch*, branch **main**, map **/ (root)**, en klik **Save**.
3. Na een minuut staat de app op **https://jellemaertens.github.io/Werkbonnen/**. Elke push naar `main` zet automatisch een nieuwe versie online.
4. Open dat adres op de tablet en kies **Toevoegen aan beginscherm** of **App installeren**. Daarna werkt de app ook offline.
5. Laad de startgegevens (zie hierboven).

Op GitHub Pages staan geen klantgegevens: `seed.local.js` zit niet in de repository.

## Waar staan de gegevens?

**Gedeeld via SharePoint** zodra het toestel de met OneDrive gesynchroniseerde map gekozen heeft, of zodra `tenantId` en `clientId` in `js/config.js` ingevuld zijn (zie [SharePoint koppelen](#sharepoint-koppelen)). Tot dan wordt alles enkel op het toestel bewaard (in de browser) en gaan werkbonnen naar kantoor via de PDF en de CSV-export. Maak in dat geval regelmatig een back-up via **Instellingen › Back-up downloaden**: wis je de browsergegevens, dan zijn de werkbonnen op dat toestel weg.

**De centrale database (Supabase) staat uit** (`centraal: false`). Het deel hieronder tot "SharePoint koppelen" beschrijft ze, voor als je ze later weer aanzet met `centraal: true`.

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

## SharePoint koppelen

Alle werkbonnen, foto's, klanten, machines, onderdelen en monteurs staan in de SharePoint-map **Diensten › Gedeelde documenten › General › MyMx › Werkbonnen Boss**. De app bereikt die map op een van twee manieren:

1. **Gesynchroniseerde map (geen IT nodig, enkel op pc).** Zoals de shakerregistratie: OneDrive zet de map op de pc en de app schrijft er rechtstreeks in. Werkt in **Edge** of **Chrome** op een Windows-pc of -laptop.
   1. Open de map in SharePoint en klik **Synchroniseren** (OneDrive moet aangemeld zijn met je BOSS-account).
   2. In de app: **Instellingen › SharePoint › Map kiezen**, kies de map **Werkbonnen Boss** en klik **Wijzigingen toestaan**. Kies je per ongeluk de bovenliggende map, dan neemt de app zelf de map Werkbonnen Boss erin.
   3. Na het herstarten van de browser vraagt de app soms opnieuw toegang (knop **Toegang geven**). Biedt de browser **Altijd toestaan** aan, kies dat dan.

   Werkt ook zonder internet: OneDrive stuurt de bestanden door zodra er verbinding is. Collega's zien wijzigingen zodra OneDrive op beide pc's gesynchroniseerd heeft (meestal binnen een minuut). Bewaren twee pc's de lijsten tegelijk, dan maakt OneDrive een kopie `lijsten-<pc>.json`; de app voegt die vanzelf terug samen. Op een telefoon of iPad kan een browser geen map openen; daar is manier 2 nodig.
2. **Aanmelden bij Microsoft (alle toestellen, eenmalig IT nodig).** De app spreekt SharePoint rechtstreeks aan via Microsoft Graph. Elke monteur meldt zich aan met zijn BOSS Microsoft 365-account; de app werkt met de rechten van die persoon op de map. Hiervoor is de app-registratie hieronder nodig.

Heeft een toestel een gesynchroniseerde map gekozen, dan gebruikt het die. Wie geen toegang heeft tot de map, krijgt in beide gevallen niets te zien.

Wat er in de map komt:

| Map | Inhoud |
|---|---|
| `Klanten/<klantnaam>/<datum en uur van het bezoek>/` | Per bezoek een map, genoemd naar het moment waarop de werkbon gemaakt is (bv. `2026-10-30 14.05.32`). Zodra de werkbon afgerond is: `Werkbon <nummer>.pdf`, `Pro forma <nummer>.pdf` en de foto's (`Foto 01 - bijschrift.jpg`). Heropent iemand de werkbon, dan verdwijnt de map tot hij opnieuw afgerond is. |
| `App-gegevens/werkbonnen/` | Elke werkbon als JSON (ook concepten), voor de app. |
| `App-gegevens/fotos/` | De foto's van alle werkbonnen, voor de app. |
| `App-gegevens/lijsten.json` | Klanten, machines, onderdelen (met prijzen) en monteurs. |

Pas de bestanden in `App-gegevens` niet met de hand aan. Het eerste toestel dat aanmeldt, vult `lijsten.json` met zijn lijsten.

Hoe het synchroniseert:

- Alles wordt eerst op het toestel bewaard, zodat de monteur offline verder kan. Wat nog niet verstuurd is, staat in een wachtrij. Rechtsboven zie je de status: `✓ 14:05`, `↑ 2` (te versturen), `Offline`, `Aanmelden` of `⚠`.
- Met netwerk synchroniseert de app bij het openen, elke minuut, en kort na elke wijziging. Werkbonnen en lijstwijzigingen van collega's verschijnen dus binnen een minuut.
- Vóór een nieuw werkbonnummer haalt de app eerst de nieuwste nummers op (max. 5 seconden), zodat alle monteurs één doorlopende reeks delen. Wie offline een werkbon begint, kan toch een nummer krijgen dat een collega al gebruikt.
- Klanten, machines en onderdelen worden per record samengevoegd: wijzigen twee mensen tegelijk iets anders, dan blijven beide wijzigingen bewaard. Wijzigen ze hetzelfde record, dan wint de laatste wijziging.
- Foto's van een collega worden pas gedownload wanneer je de werkbon opent of de PDF maakt.

### Eenmalig door IT: app-registratie in Microsoft Entra ID

1. **Entra-beheercentrum › App-registraties › Nieuwe registratie.** Naam bv. `Werkbonnen-app`, enkel accounts in deze organisatie.
2. **Verificatie › Platform toevoegen › App met één pagina (SPA)** met deze omleidings-URI's:
   - `https://jellemaertens.github.io/Werkbonnen/`
   - `http://localhost:8080/` (om te testen op de pc)
3. **API-machtigingen › Microsoft Graph › Gedelegeerde machtigingen:** `User.Read`, `Files.ReadWrite.All` (en standaard `openid`, `profile`, `offline_access`). Laat een beheerder **toestemming verlenen voor BOSS** als gebruikers dat zelf niet mogen. Gedelegeerd betekent: de app kan enkel wat de aangemelde persoon zelf mag.
4. Geef de **Map-id (tenant)** en **Toepassings-id (client)** van het overzicht door. Die komen in `js/config.js` bij `tenantId` en `clientId`. Het zijn geen geheimen; er is geen clientgeheim nodig.
5. Zorg dat elke monteur **bewerkrechten** heeft op de map Werkbonnen Boss.

Voor een app met één pagina blijft een aanmelding volgens Microsoft maximaal 24 uur geldig. Na 20 uur meldt de app zich daarom **vanzelf opnieuw aan** met het laatst gebruikte account: ze gaat even langs Microsoft (zonder scherm, `prompt=none`) en komt aangemeld terug. Met een actieve Microsoft 365-sessie op het toestel is daar geen klik voor nodig. Dat gebeurt enkel wanneer er geen werkbon en geen venster open staat, dus nooit tijdens het invullen of ondertekenen, en hoogstens één keer per 10 minuten. Lukt het niet (geen Microsoft-sessie, geen internet), dan verschijnt de knop **Aanmelden**. Wie zelf afmeldt bij **Instellingen**, wordt niet meer vanzelf aangemeld. Wat intussen gemaakt is, blijft in de wachtrij.

### Lokaal testen met een nagebootste SharePoint

`serve.ps1 -Graph` doet het deel van Microsoft Graph na dat de app gebruikt, met de bestanden in de map `werkbon-sharepoint-test` naast `werkbon-app` (staat in `.gitignore`).

```bash
powershell -ExecutionPolicy Bypass -File serve.ps1 -Port 8097 -Graph
```

Start de app op twee poorten (bv. 8095 en 8096: twee "toestellen") en voer in de browserconsole van elk uit:

```js
localStorage.setItem('werkbonnen.sp.test', JSON.stringify({ graph: 'http://localhost:8097/graph/v1.0', driveId: 'test', mapId: 'root', testToken: true }))
```

Dit werkt enkel op `localhost` en slaat de Microsoft-aanmelding over. Om het aanmelden zelf te testen, gebruik je in plaats van `testToken: true` de nagebootste aanmelding van dezelfde server: `tenantId: 't', clientId: 'c', login: 'http://localhost:8097/login'`. Een `login_hint` die begint met `geen-sessie` speelt na dat er geen Microsoft-sessie is.

De gesynchroniseerde map test je met `{ opfs: true }` als `werkbonnen.sp.test`: dan neemt de eigen opslag van de browser de plaats in van de OneDrive-map (geen mapkiezer nodig). Getest: werkbon, foto's, lijsten en bezoekmap met PDF's in de map, een conflictkopie `lijsten-<pc>.json` die samengevoegd en opgeruimd wordt, een conflictkopie van een werkbon die genegeerd wordt, een wijziging van een collega die binnenkomt, en een verdwenen map (foutmelding, niets gewist). Het echte kiezen van een OneDrive-map en de toestemming van de browser zijn enkel met de hand te testen. Getest: gedeelde nummering, werkbonnen en foto's van het ene toestel op het andere, de bezoekmap met PDF's en foto's, heropenen, wissen, klanten die op beide toestellen tegelijk gewijzigd worden, en het vanzelf opnieuw aanmelden (gelukt, mislukt zonder te blijven proberen, en niet terwijl een werkbon open staat). De echte aanmelding bij Microsoft is pas te testen na de app-registratie.

## Centrale database opzetten (Lovable Cloud / Supabase)

1. **Database aanmaken.** Open het project in Lovable met **Lovable Cloud** aan (dat is een Supabase-database). Laat de SQL uit `supabase/migrations/001_werkbon_centraal.sql` uitvoeren: vraag het in de Lovable-chat ("voer deze migratie uit") of plak ze in de SQL-editor van Supabase. Keur de wijziging in Lovable goed, anders wordt ze niet uitgevoerd. Dit maakt de tabellen `wb_monteurs`, `wb_klanten`, `wb_machines`, `wb_onderdelen` en `wb_werkbonnen` aan, met de beveiliging via de teamcode. Alles begint met `wb_` omdat Lovable in hetzelfde project vaak zelf tabellen als `klanten` of `werkbonnen` aanmaakt, met een andere opbouw.
2. **Teamcode kiezen.** Voer uit (met je eigen code). Zet de echte code nooit in het migratiebestand, dat staat mee in de broncode:
   ```sql
   update public.wb_config set waarde = 'jouw-geheime-teamcode' where sleutel = 'teamcode';
   ```
3. **App koppelen.** Vul in `js/config.js` de **Project URL** en de **anon/publishable key** in. In Lovable staan ze in het bestand `.env` van het project (`VITE_SUPABASE_URL` en `VITE_SUPABASE_PUBLISHABLE_KEY`), in Supabase bij Project Settings › API. Dan moeten de toestellen enkel nog de teamcode invullen. Je kunt URL en sleutel ook per toestel invullen bij **Instellingen › Centrale database**.
4. **App online zetten.** Zie [Hosten in Lovable](#hosten-in-lovable) hieronder. Je kunt de app ook op een andere https-hosting zetten en Lovable Cloud enkel als database gebruiken.
5. **Vullen.** Open de app op één toestel, meld je aan, ga naar **Beheer** en klik **Lijsten van dit toestel uploaden**. Duid jezelf aan als beheerder en controleer de voorvoegsels van de monteurs.
6. **Toestellen.** Open de app op elke tablet, kies de monteur, vul de teamcode in. Bij **Instellingen › Centrale database** kan je met **Verbinding testen** nagaan of alles klopt.

### Getest met het echte Lovable Cloud-project

Getest vanaf `http://localhost` tegen het echte project:

- De publieke sleutel van het nieuwe type (`sb_publishable_…`) werkt. De app stuurt `Authorization: Bearer` enkel mee voor oude sleutels die met `eyJ` beginnen. Supabase aanvaardt beide.
- CORS laat de extra header `x-team-code` toe vanaf een ander adres.
- Met een verkeerde of ontbrekende teamcode:
  - geeft lezen een lege lijst;
  - weigert de database toevoegen (`new row violates row-level security policy`);
  - verandert wijzigen of wissen niets;
  - is `wb_config` onleesbaar;
  - geeft `wb_teamcode_ok` `false`.
- Met de juiste teamcode synchroniseert de app op `localhost:8080` (verzenden met `on_conflict=id` en `resolution=merge-duplicates`, en ophalen op `bijgewerkt_op`). De volledige test met twee toestellen staat nog open: een werkbon offline maken op het ene toestel, en een klant die centraal toegevoegd wordt op het andere zien verschijnen.

Lovable kan in hetzelfde project eigen tabellen en functies hebben die niet door deze migratie beveiligd zijn. Kijk die na in Lovable (**Cloud › Database**, of vraag de Lovable-chat om een beveiligingsscan).

### Hosten in Lovable (niet in gebruik)

Niet in gebruik: de app staat op GitHub Pages. Ter info: een Lovable-project is zelf een Vite/React-app. Bestanden in de map `public/` worden ongewijzigd mee gepubliceerd. Daar kan de werkbon-app dus naast de React-app staan:

1. Zet de inhoud van `werkbon-app` in de map **`public/werkbon/`** van het Lovable-project, via de GitHub-koppeling van Lovable of door de bestanden te laten toevoegen. Neem `supabase/`, `serve.ps1`, `_printtest.html` en `README.md` niet mee: die horen niet op een publieke website.
2. Publiceer in Lovable (**Publish**). De app staat dan op `https://<jouw-project>.lovable.app/werkbon/index.html`. Gebruik dat volledige adres met `index.html`: voor andere adressen kan Lovable de eigen React-app tonen.
3. Open dat adres op de tablet en kies **Toevoegen aan beginscherm**. Alle paden in de app zijn relatief, dus offline werking en installeren werken ook vanuit een submap.

Deze hosting in Lovable is nog niet uitgeprobeerd.

### De database bekijken

In de tabel `wb_werkbonnen` staat de volledige werkbon als JSON in de kolom `data`. Voor overzichten zijn er ook gewone kolommen: `nummer`, `datum`, `status`, `monteur`, `klant_naam`, `gewijzigd_door` en `bijgewerkt_op` (tijdstip van ontvangst). Verwijderde records krijgen `verwijderd = true`, zodat ook andere toestellen ze kunnen wissen.

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
| `js/db.js` | Opslag op het toestel (IndexedDB), inclusief de wachtrijen (`outbox`, `spwachtrij`) en foto's |
| `js/sharepoint.js` | Aanmelden bij Microsoft en synchronisatie met de SharePoint-map |
| `js/sync.js` | Elke wijziging gaat hierlangs: naar SharePoint en/of de centrale database |
| `js/config.js` | SharePoint-koppeling (`tenantId`, `clientId`, map) en centrale database aan/uit |
| `supabase/migrations/001_werkbon_centraal.sql` | Tabellen en beveiliging van de centrale database |
| `data/seed.js` | Startgegevens: klanten, machines, onderdelen, monteurs |
| `sw.js` | Offline werking |
| `serve.ps1` | Kleine webserver om lokaal te testen (met `-Api` een test-database, met `-Graph` een nagebootste SharePoint) |
