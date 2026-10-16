// Builds the printable A4 werkbon and pro forma in BOSS paints huisstijl (kleurvlakken, Mona Sans, officieel logo).
// "Opslaan als PDF" in the print dialog turns them into a PDF.
const DEFAULT_LOGO = 'assets/BP-Baseline-RGB-POS-NL.png';          // positief, voor witte achtergrond
const DEFAULT_LOGO_WIT = 'assets/logo_BOSS_NL_baseline_wit.png';   // negatief, voor BOSS Dark Green

const PRINT_CSS = `
    .p, .p * { box-sizing: border-box; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    .p { font: 9.5pt/1.35 "Mona Sans", Arial, Helvetica, sans-serif; font-feature-settings: "ss03"; color: #000; }
    .p table { border-collapse: separate; border-spacing: 0; }

    /* Kop: BOSS Dark Green vlak met negatief logo */
    .p-head { display: flex; justify-content: space-between; align-items: center; gap: 8mm; padding: 4.5mm 6mm; border-radius: 1mm; background: #0D3932; color: #fff; }
    .p-head.own { background: #fff; color: #0D3932; padding: 0 0 4mm; border-bottom: 2px solid #0D3932; border-radius: 0; }
    .p-logo { height: 14mm; width: auto; display: block; }
    .p-titleblock { text-align: right; }
    .p-title { font-size: 22pt; font-weight: 700; line-height: 1; }
    .p-nr { font-size: 12pt; font-weight: 700; color: #A1D377; margin-top: 2mm; }
    .p-sub { font-size: 8.5pt; margin-top: 1mm; opacity: .85; }
    .p-head.own .p-title { color: #226E55; }
    .p-head.own .p-nr { color: #0D3932; }

    /* Gegevensvlakken */
    .p-cards { display: grid; grid-template-columns: 1.15fr 1fr 1fr; gap: 3mm; margin-top: 3mm; }
    .p-cards.two { grid-template-columns: 1fr 1fr; }
    .p-card { background: #E2E7DC; border-radius: 1mm; padding: 2.5mm 3.5mm; }
    .p-cap { font: 700 8pt/1.2 "Mona Sans Condensed", "Mona Sans", Arial, sans-serif; text-transform: uppercase; letter-spacing: .04em; color: #226E55; margin-bottom: 1.5mm; }
    .p-card th { text-align: left; font-weight: 700; padding: .4mm 2.5mm .4mm 0; white-space: nowrap; vertical-align: top; width: 1%; }
    .p-card td { padding: .4mm 0; vertical-align: top; }
    .p-name { font-weight: 700; font-size: 10.5pt; color: #0D3932; }

    /* Aanleiding: BOSS Forest Green vlak */
    .p-cause { background: #226E55; color: #fff; border-radius: 1mm; padding: 2.2mm 3.5mm; margin-top: 3mm; display: flex; gap: 6mm; align-items: baseline; }
    .p-cause .p-cap { color: #A1D377; margin: 0; }

    /* Tekstsecties */
    .p-sec { margin-top: 3mm; break-inside: avoid; }
    .p-sec-h { background: #E2E7DC; color: #0D3932; border-radius: 1mm; padding: 1.3mm 3.5mm; font-weight: 700; font-size: 10.5pt; }
    .p-sec-b { padding: 1.5mm 3.5mm 0; }

    /* Tabellen: geen randen, structuur via kleurvlakken */
    .p-table { width: 100%; margin-top: 3mm; }
    .p-table th { background: #0D3932; box-shadow: 1px 0 0 #0D3932; color: #fff; text-align: left; padding: 1.6mm 3mm; font: 700 8pt/1.3 "Mona Sans Condensed", "Mona Sans", Arial, sans-serif; text-transform: uppercase; letter-spacing: .04em; }
    .p-table th:first-child { border-radius: 1mm 0 0 1mm; }
    .p-table th:last-child { border-radius: 0 1mm 1mm 0; }
    .p-table td { padding: 1.2mm 3mm; vertical-align: top; }
    .p-table tbody tr:nth-child(even) td { background: #EFF2EC; box-shadow: 1px 0 0 #EFF2EC; }
    .p .p-table th:last-child, .p .p-table tbody tr td:last-child, .p .p-totals tr td:last-child { box-shadow: none; }
    .p-table .r { text-align: right; white-space: nowrap; font-variant-numeric: tabular-nums; }
    .p-table .code { color: #226E55; font-weight: 700; white-space: nowrap; }
    .p-table .muted { color: #4F5E58; font-size: 8.5pt; }
    .p-table tr { break-inside: avoid; }

    .p-costrow { display: grid; grid-template-columns: 1fr 72mm; gap: 3mm; align-items: start; margin-top: 3mm; break-inside: avoid; }
    .p-costrow .p-table { margin-top: 0; }
    .p-totals { margin: 3mm 0 0 auto; width: 72mm; break-inside: avoid; font-variant-numeric: tabular-nums; }
    .p-costrow .p-totals { margin: 0; width: 100%; }
    .p-totals td { padding: 1.3mm 3mm; background: #E2E7DC; box-shadow: 1px 0 0 #E2E7DC; }
    .p-totals td:last-child { text-align: right; white-space: nowrap; }
    .p-totals tr:first-child td:first-child { border-top-left-radius: 1mm; }
    .p-totals tr:first-child td:last-child { border-top-right-radius: 1mm; }
    .p-totals .g td { background: #0D3932; box-shadow: 1px 0 0 #0D3932; color: #fff; font-weight: 700; font-size: 11pt; padding: 2.4mm 3mm; }
    .p-totals .g td:last-child { color: #A1D377; }
    .p-totals .g td:first-child { border-bottom-left-radius: 1mm; }
    .p-totals .g td:last-child { border-bottom-right-radius: 1mm; }

    /* Akkoord */
    .p-bottom { break-inside: avoid; margin-top: 4mm; display: grid; grid-template-columns: 1fr 1.4fr; gap: 3mm; }
    .p-sigbox { background: #fff; border-radius: 1mm; height: 22mm; display: flex; align-items: center; justify-content: center; margin-top: 1mm; }
    .p-sigbox img { max-height: 20mm; max-width: 95%; display: block; }
    .p-signame { margin-top: 1.5mm; }
    .p-unsigned { font-weight: 700; color: #0D3932; text-align: center; }
    .p-terms { font-size: 7.5pt; line-height: 1.35; color: #4F5E58; margin-top: 3mm; }

    /* Pro forma: duidelijke melding dat dit geen factuur is */
    .p-pf { background: #F7CC9D; color: #69372B; border-radius: 1mm; padding: 2.4mm 3.5mm; margin-top: 3mm; font-weight: 700; }
    .p-pf span { font-weight: 400; }
    .p-note { background: #E2E7DC; border-radius: 1mm; padding: 2.5mm 3.5mm; font-size: 8.5pt; }

    /* Voet: BOSS Dark Green band op elke pagina. De lege tfoot houdt er op elke pagina plaats voor vrij. */
    .p-page { width: 100%; }
    .p-page > tbody > tr > td, .p-page > tfoot > tr > td { padding: 0; }
    .p-footer-space { height: 12mm; }
    .p-footer { position: fixed; left: 0; right: 0; bottom: 0; background: #0D3932; color: #fff; border-radius: 1mm; padding: 2.2mm 4mm; font-size: 7.5pt; text-align: center; }
`;

const printLines = txt => esc(txt).replace(/\n/g, '<br>');
const printRow = (label, val) => val ? `<tr><th>${label}</th><td>${val}</td></tr>` : '';

// Address without the country line for Belgian customers (saves a line on the page)
const printAdres = k => [k.adres, [k.postcode, k.gemeente].filter(Boolean).join(' '), /^(BE|België|Belgie)$/i.test(k.land || '') ? '' : k.land].filter(Boolean).join('\n');

function printFooter(b) {
  return [
    b.naam,
    [b.adres, [b.land === 'België' ? 'BE' : '', b.postcode, b.gemeente].filter(Boolean).join(' ')].filter(Boolean).join(', '),
    b.website, b.telefoon, b.email, b.btw && `BTW ${b.btw}`, b.iban && `IBAN ${b.iban}`,
  ].filter(Boolean).map(esc).join(' &nbsp;|&nbsp; ');
}

function printHead(b, titel, nummer, sub = '') {
  const ownLogo = !!b.logo;
  return `<div class="p-head ${ownLogo ? 'own' : ''}">
      <img class="p-logo" src="${esc(ownLogo ? b.logo : DEFAULT_LOGO_WIT)}" alt="${esc(b.naam)}">
      <div class="p-titleblock">
        <div class="p-title">${esc(titel)}</div>
        <div class="p-nr">${esc(nummer)}</div>
        ${sub ? `<div class="p-sub">${esc(sub)}</div>` : ''}
      </div>
    </div>`;
}

// Page frame: content, plus the footer band on every page
function printPage(b, inner) {
  const footer = printFooter(b);
  return `
  <style>${PRINT_CSS}</style>
  <div class="p">
   <table class="p-page"><tbody><tr><td>${inner}</td></tr></tbody>
   <tfoot><tr><td><div class="p-footer-space"></div></td></tr></tfoot>
   </table>
   ${footer ? `<div class="p-footer">${footer}</div>` : ''}
  </div>`;
}

// Prestaties en kosten as [omschrijving, aantal (tekst), eenheidsprijs, totaal]
function kostenRegels(wb) {
  const rows = [];
  if (parseNum(wb.werkuren)) rows.push([`Werkuren${wb.interventie ? ' ' + wb.interventie.toLowerCase() : ''}`, `${fmtNum(parseNum(wb.werkuren))} u`, parseNum(wb.uurtarief), parseNum(wb.werkuren) * parseNum(wb.uurtarief)]);
  if (wb.aanrijkost.actief) rows.push(['Aanrijkost', '1', parseNum(wb.aanrijkost.bedrag), parseNum(wb.aanrijkost.bedrag)]);
  if (wb.brandstoftoeslag.actief) rows.push(['Brandstoftoeslag', '1', parseNum(wb.brandstoftoeslag.bedrag), parseNum(wb.brandstoftoeslag.bedrag)]);
  for (const l of wb.extra) rows.push([l.omschrijving, fmtNum(parseNum(l.aantal)), parseNum(l.prijs), parseNum(l.aantal) * parseNum(l.prijs)]);
  return rows;
}

function totalsHtmlPrint(wb, t) {
  return `<table class="p-totals">
      <tr><td>Totaal excl. BTW</td><td>${fmtEur(t.excl)}</td></tr>
      <tr><td>BTW ${fmtNum(parseNum(wb.btw))}%</td><td>${fmtEur(t.btw)}</td></tr>
      <tr class="g"><td>Totaal incl. BTW</td><td>${fmtEur(t.incl)}</td></tr>
    </table>`;
}

/* ---------- Werkbon ---------- */
function werkbonPrintHtml(wb, s) {
  const b = s.bedrijf;
  const t = totals(wb);
  const prices = s.prijzenOpWerkbon;
  const aanleiding = [wb.interventie, wb.melding].filter(Boolean).join(' — ');
  const costRows = kostenRegels(wb);

  // Costs on the left, totals beside them on the right
  const costTable = costRows.length ? `<table class="p-table">
      <thead><tr><th>Prestaties en kosten</th><th class="r">Aantal</th>${prices ? '<th class="r">Tarief</th><th class="r">Totaal</th>' : ''}</tr></thead>
      <tbody>${costRows.map(([d, q, p, tot]) => `<tr><td>${esc(d)}</td><td class="r">${esc(q)}</td>${prices ? `<td class="r">${fmtEur(p)}</td><td class="r">${fmtEur(tot)}</td>` : ''}</tr>`).join('')}</tbody>
    </table>` : '';
  const totalsTable = prices ? totalsHtmlPrint(wb, t) : '';

  let klantSign;
  if (wb.handtekening) {
    klantSign = `<div class="p-sigbox"><img src="${wb.handtekening.beeld}" alt="Handtekening"></div>
      <div class="p-signame"><b>${esc(wb.handtekening.naam)}</b><br>${esc(fmtDateTime(wb.handtekening.datum))}</div>`;
  } else if (wb.nietOndertekend) {
    klantSign = `<div class="p-sigbox p-unsigned">✓ Niet ondertekend:<br>${esc(wb.nietOndertekend)}</div>`;
  } else {
    klantSign = `<div class="p-sigbox"></div><div class="p-signame">Naam:</div>`;
  }

  return printPage(b, `
    ${printHead(b, 'Werkbon', wb.nummer)}

    <div class="p-cards">
      <div class="p-card">
        <div class="p-cap">Klant</div>
        <div class="p-name">${esc(wb.klant?.naam || '')}</div>
        <div>${printLines(printAdres(wb.klant || {}))}</div>
        <table style="margin-top:1.5mm">
          ${printRow('Contact:', esc(wb.klant?.contact))}
          ${printRow('Klantnr.:', esc(wb.klant?.nummer))}
          ${printRow('Referentie:', esc(wb.referentie))}
        </table>
      </div>
      <div class="p-card">
        <div class="p-cap">Machine</div>
        ${wb.machine ? `<div class="p-name">${esc(wb.machine.model)}</div>
        <table style="margin-top:1mm">
          ${printRow('Fabrikant:', esc(wb.machine.fabrikant))}
          ${printRow('Soort:', esc(wb.machine.soort))}
          ${printRow('Serienr.:', esc(wb.machine.serienummer))}
        </table>` : '<div>—</div>'}
      </div>
      <div class="p-card">
        <div class="p-cap">Bezoek</div>
        <table>
          ${printRow('Datum:', esc(fmtDate(wb.datum)))}
          ${printRow('Start:', esc(wb.starttijd))}
          ${printRow('Einde:', esc(wb.eindtijd))}
          ${printRow('Werktijd:', parseNum(wb.werkuren) ? `${fmtNum(parseNum(wb.werkuren))} u` : '')}
          ${printRow('Monteur:', esc(wb.monteur))}
        </table>
      </div>
    </div>

    ${aanleiding ? `<div class="p-cause"><div class="p-cap">Aanleiding</div><div>${esc(aanleiding)}</div></div>` : ''}
    ${wb.bevindingen ? `<div class="p-sec"><div class="p-sec-h">Bevindingen</div><div class="p-sec-b">${printLines(wb.bevindingen)}</div></div>` : ''}
    <div class="p-sec"><div class="p-sec-h">Uitgevoerde werkzaamheden</div><div class="p-sec-b">${printLines(wb.werkzaamheden) || '—'}</div></div>

    ${wb.onderdelen.length ? `<table class="p-table">
      <thead><tr><th>Artikelnummer</th><th>Gebruikte onderdelen</th><th class="r">Aantal</th>${prices ? '<th class="r">Prijs</th><th class="r">Totaal</th>' : ''}</tr></thead>
      <tbody>${wb.onderdelen.map(l => `<tr><td class="code">${esc(l.artikelnr)}</td><td>${esc(l.omschrijving)}</td><td class="r">${fmtNum(parseNum(l.aantal))}</td>
        ${prices ? `<td class="r">${fmtEur(parseNum(l.prijs))}</td><td class="r">${fmtEur(parseNum(l.aantal) * parseNum(l.prijs))}</td>` : ''}</tr>`).join('')}</tbody>
    </table>` : ''}

    ${costTable && totalsTable ? `<div class="p-costrow">${costTable}${totalsTable}</div>` : costTable + totalsTable}

    <div class="p-bottom">
      <div class="p-card">
        <div class="p-cap">Uitgevoerd door</div>
        <div class="p-name">${esc(wb.monteur || '—')}</div>
        <div>${esc(b.naam)}</div>
        <div>${esc(fmtDate(wb.datum))}${wb.eindtijd ? `, afgerond om ${esc(wb.eindtijd)}` : ''}</div>
        ${s.voorwaarden ? `<div class="p-terms">${esc(s.voorwaarden)}</div>` : ''}
      </div>
      <div class="p-card">
        <div class="p-cap">Voor akkoord, de klant</div>
        ${klantSign}
      </div>
    </div>`);
}

/* ---------- Pro forma ---------- */
// Pro forma for the visit: all prices and BTW, numbered with the werkbon number. Not an invoice.
function proformaPrintHtml(wb, s) {
  const b = s.bedrijf;
  const t = totals(wb);
  const k = wb.klant || {};
  const live = (typeof klantById === 'function' && wb.klantId && klantById(wb.klantId)) || {};
  const klantBtw = live.btw || k.btw || '';
  const btwPct = `${fmtNum(parseNum(wb.btw))}%`;
  const datum = wb.afgerondOp ? wb.afgerondOp.slice(0, 10) : today();

  const regels = [
    ...wb.onderdelen.map(l => ({
      code: l.artikelnr, oms: l.omschrijving, aantal: fmtNum(parseNum(l.aantal)),
      prijs: parseNum(l.prijs), totaal: parseNum(l.aantal) * parseNum(l.prijs),
    })),
    ...kostenRegels(wb).map(([oms, aantal, prijs, totaal]) => ({ code: '', oms, aantal, prijs, totaal })),
  ];

  const akkoord = wb.handtekening
    ? `${esc(wb.handtekening.naam)}, ${esc(fmtDateTime(wb.handtekening.datum))}`
    : wb.nietOndertekend ? `Niet ondertekend (${esc(wb.nietOndertekend)})` : '';

  return printPage(b, `
    ${printHead(b, 'Pro forma', wb.nummer, `Datum ${fmtDate(datum)}`)}

    <div class="p-pf">Pro forma, geen factuur. <span>Dit overzicht toont de kosten van het bezoek. De factuur volgt later van onze boekhouding.</span></div>

    <div class="p-cards two">
      <div class="p-card">
        <div class="p-cap">Aan</div>
        <div class="p-name">${esc(k.naam || '')}</div>
        <div>${printLines(printAdres(k))}</div>
        <table style="margin-top:1.5mm">
          ${printRow('BTW-nr.:', esc(klantBtw))}
          ${printRow('Klantnr.:', esc(k.nummer))}
          ${printRow('Contact:', esc(k.contact))}
        </table>
      </div>
      <div class="p-card">
        <div class="p-cap">Bezoek</div>
        <table>
          ${printRow('Werkbon:', esc(wb.nummer))}
          ${printRow('Bezoekdatum:', esc(fmtDate(wb.datum)))}
          ${printRow('Referentie:', esc(wb.referentie))}
          ${printRow('Monteur:', esc(wb.monteur))}
          ${printRow('Machine:', esc([wb.machine?.model, wb.machine?.serienummer && `SN ${wb.machine.serienummer}`].filter(Boolean).join(' · ')))}
          ${printRow('Akkoord klant:', akkoord)}
        </table>
      </div>
    </div>

    ${wb.werkzaamheden ? `<div class="p-sec"><div class="p-sec-h">Uitgevoerde werkzaamheden</div><div class="p-sec-b">${printLines(wb.werkzaamheden)}</div></div>` : ''}

    <table class="p-table">
      <thead><tr><th>Omschrijving</th><th class="r">Aantal</th><th class="r">Eenheidsprijs</th><th class="r">BTW</th><th class="r">Totaal excl. BTW</th></tr></thead>
      <tbody>${regels.map(r => `<tr>
        <td>${r.code ? `<span class="code">${esc(r.code)}</span> &nbsp;` : ''}${esc(r.oms)}</td>
        <td class="r">${esc(r.aantal)}</td><td class="r">${fmtEur(r.prijs)}</td><td class="r">${btwPct}</td><td class="r">${fmtEur(r.totaal)}</td>
      </tr>`).join('') || '<tr><td colspan="5">—</td></tr>'}</tbody>
    </table>

    <div class="p-costrow">
      <div class="p-note">
        <div class="p-cap">Betaling</div>
        Betaal nog niet op basis van deze pro forma: je ontvangt de factuur met de betalingsgegevens van onze boekhouding.
        ${b.iban ? `<br>Rekeningnummer: <b>${esc(b.iban)}</b>` : ''}
      </div>
      ${totalsHtmlPrint(wb, t)}
    </div>`);
}

/* ---------- Printing ---------- */
function printDocument(html, titel) {
  const root = document.getElementById('print-root');
  root.innerHTML = html;
  // The document title becomes the suggested file name when saving as PDF
  const oldTitle = document.title;
  document.title = titel;
  const restore = () => { document.title = oldTitle; window.removeEventListener('afterprint', restore); };
  window.addEventListener('afterprint', restore);
  // Wait for Mona Sans, the logo and the signature before the print dialog opens
  const imgs = [...root.querySelectorAll('img')];
  Promise.all([document.fonts?.ready, ...imgs.map(i => i.decode?.().catch(() => {}))]).then(() => window.print());
}

function printWerkbon(wb, settings) {
  printDocument(werkbonPrintHtml(wb, settings), `Werkbon ${wb.nummer} ${wb.klant?.naam || ''}`.trim());
}

function printProforma(wb, settings) {
  printDocument(proformaPrintHtml(wb, settings), `Pro forma ${wb.nummer} ${wb.klant?.naam || ''}`.trim());
}
