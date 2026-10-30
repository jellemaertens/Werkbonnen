// Makes a real PDF file of the werkbon or pro forma, from the same BOSS layout as print.js.
// html2canvas draws the layout, jsPDF puts it on A4 pages. Both live in assets/vendor (MIT
// license) and are only loaded the first time a PDF is made, so they also work offline.
const PDF = (() => {
  const A4 = { w: 210, h: 297 };
  const MARGIN = { top: 14, side: 14, bottom: 8 };   // mm
  const CONTENT_W = A4.w - 2 * MARGIN.side;          // 182 mm, same width as the printed page
  const SCALE = 2.5;                                 // ~240 dpi: sharp on paper, reasonable file size

  const loaded = {};
  function loadScript(src) {
    loaded[src] ??= new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = src;
      s.onload = resolve;
      s.onerror = () => { delete loaded[src]; reject(new Error(`Kon ${src} niet laden`)); };
      document.head.appendChild(s);
    });
    return loaded[src];
  }
  const libs = () => Promise.all([
    loadScript('assets/vendor/html2canvas.min.js'),
    loadScript('assets/vendor/jspdf.umd.min.js'),
  ]);

  // Renders the print HTML off-screen at the printed width
  function mount(html) {
    const host = document.createElement('div');
    host.style.cssText = `position:fixed; left:-10000px; top:0; width:${CONTENT_W}mm; background:#fff; z-index:-1`;
    host.innerHTML = html;
    document.body.appendChild(host);
    const footer = host.querySelector('.p-footer');
    host.querySelector('.p-footer-space')?.remove();
    if (footer) {
      // The footer band is drawn separately on every page
      footer.style.position = 'static';
      footer.remove();
      host.appendChild(Object.assign(document.createElement('div'), { className: 'p pdf-footer' })).appendChild(footer);
    }
    return { host, content: host.querySelector('.p'), footer: footer ? host.querySelector('.pdf-footer') : null };
  }

  async function ready(host) {
    await document.fonts?.ready;
    await Promise.all([...host.querySelectorAll('img')].map(i => i.decode?.().catch(() => {})));
  }

  // Page breaks only between blocks or table rows, never through them
  function breakPoints(content) {
    const top = content.getBoundingClientRect().top;
    const sel = '.p-head, .p-pf, .p-cards, .p-cause, .p-sec, .p-table tr, .p-costrow, .p-bottom, .p-totals, .p-foto-rij';
    return [...content.querySelectorAll(sel)].map(el => (el.getBoundingClientRect().bottom - top) * SCALE).sort((a, b) => a - b);
  }

  // Blocks marked data-nieuwe-pagina (the photo page) always start on a new page
  function forcedBreaks(content) {
    const top = content.getBoundingClientRect().top;
    return [...content.querySelectorAll('[data-nieuwe-pagina]')].map(el => (el.getBoundingClientRect().top - top) * SCALE);
  }

  async function render(html, titel) {
    await libs();
    const { host, content, footer } = mount(html);
    try {
      await ready(host);
      const opts = { scale: SCALE, backgroundColor: '#ffffff', logging: false, useCORS: true };
      const canvas = await window.html2canvas(content, opts);
      const footCanvas = footer ? await window.html2canvas(footer, opts) : null;
      const pxPerMm = canvas.width / CONTENT_W;
      const footH = footCanvas ? footCanvas.height / pxPerMm : 0;
      const pageH = (A4.h - MARGIN.top - MARGIN.bottom - footH - 4) * pxPerMm; // usable height per page, in px
      const breaks = breakPoints(content);
      const forced = forcedBreaks(content);

      const { jsPDF } = window.jspdf;
      const pdf = new jsPDF({ unit: 'mm', format: 'a4', compress: true });
      pdf.setProperties({ title: titel, creator: 'Werkbonnen-app' });
      const footImg = footCanvas ? footCanvas.toDataURL('image/jpeg', 0.92) : null;

      for (let y = 0, page = 0; y < canvas.height - 1; page++) {
        let end = Math.min(canvas.height, y + pageH);
        const nieuwePagina = forced.find(b => b > y + 20 && b < end);
        if (nieuwePagina) end = nieuwePagina;
        else if (end < canvas.height) {
          const best = breaks.filter(b => b > y + 20 && b <= end).pop();
          if (best) end = best;
        }
        const slice = document.createElement('canvas');
        slice.width = canvas.width;
        slice.height = Math.ceil(end - y);
        const ctx = slice.getContext('2d');
        ctx.fillStyle = '#fff';
        ctx.fillRect(0, 0, slice.width, slice.height);
        ctx.drawImage(canvas, 0, y, canvas.width, slice.height, 0, 0, slice.width, slice.height);
        if (page) pdf.addPage();
        pdf.addImage(slice.toDataURL('image/jpeg', 0.92), 'JPEG', MARGIN.side, MARGIN.top, CONTENT_W, slice.height / pxPerMm);
        if (footImg) pdf.addImage(footImg, 'JPEG', MARGIN.side, A4.h - MARGIN.bottom - footH, CONTENT_W, footH);
        y = end;
      }
      return pdf.output('blob');
    } finally {
      host.remove();
    }
  }

  const veiligeNaam = s => s.replace(/[\\/:*?"<>|]+/g, '-').replace(/\s+/g, ' ').trim();

  // Makes the PDF and offers it: open (to save or print), download, or share on a tablet/phone
  async function maak(html, titel) {
    const bezig = openModal({ title: 'PDF maken…', body: '<p class="muted" style="margin:0">Even geduld, de PDF wordt gemaakt.</p>', dismissable: false });
    let blob;
    try {
      blob = await render(html, titel);
    } catch (e) {
      console.error(e);
      bezig.close();
      toast(`PDF maken mislukt: ${e.message}`);
      return;
    }
    bezig.close();

    const naam = `${veiligeNaam(titel)}.pdf`;
    const file = new File([blob], naam, { type: 'application/pdf' });
    const url = URL.createObjectURL(file);
    const kanDelen = !!navigator.canShare?.({ files: [file] });
    const m = openModal({
      title: 'PDF klaar',
      body: `<p style="margin-top:0"><b>${esc(naam)}</b> <span class="muted small">(${Math.max(1, Math.round(blob.size / 1024))} KB)</span></p>
        <p class="muted small" style="margin-bottom:0">Open de PDF om ze te bewaren of af te drukken, of download ze meteen.</p>`,
      foot: `${kanDelen ? '<button type="button" class="btn" data-share>Delen</button>' : ''}
        <a class="btn" href="${url}" download="${esc(naam)}" data-download>Downloaden</a>
        <a class="btn primary" href="${url}" target="_blank" rel="noopener" data-open>Openen</a>`,
      onClose: () => setTimeout(() => URL.revokeObjectURL(url), 60000),
    });
    $('[data-download]', m.el).addEventListener('click', () => setTimeout(m.close, 300));
    $('[data-open]', m.el).addEventListener('click', () => setTimeout(m.close, 300));
    $('[data-share]', m.el)?.addEventListener('click', async () => {
      try { await navigator.share({ files: [file], title: titel }); m.close(); } catch { /* cancelled */ }
    });
  }

  return { maak, render };
})();

async function pdfWerkbon(wb, settings) {
  // The photos of this werkbon go on an extra page, unless switched off on the werkbon
  const fotos = wb.fotosOpPdf === false ? [] : await fotosVan(wb.id);
  const items = fotos.map(f => ({ src: URL.createObjectURL(f.blob), bijschrift: f.bijschrift }));
  try {
    await PDF.maak(werkbonPrintHtml(wb, settings, items), `Werkbon ${wb.nummer} ${wb.klant?.naam || ''}`.trim());
  } finally {
    items.forEach(i => URL.revokeObjectURL(i.src));
  }
}

function pdfProforma(wb, settings) {
  return PDF.maak(proformaPrintHtml(wb, settings), `Pro forma ${wb.nummer} ${wb.klant?.naam || ''}`.trim());
}
