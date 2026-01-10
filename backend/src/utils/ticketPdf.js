import puppeteer from 'puppeteer';
import { buildTicketHtml } from './ticketTemplate.js';

const defaultPdfOptions = {
  format: 'A4',
  printBackground: true,
  margin: { top: '10mm', bottom: '10mm', left: '10mm', right: '10mm' },
};

export async function generateTicketPdf(ticket, options = {}) {
  const html = buildTicketHtml(ticket);
  return generatePdfFromHtml(html, options);
}

export async function generatePdfFromHtml(html, options = {}) {
  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });

  try {
    const page = await browser.newPage();
    page.setDefaultTimeout(60000);
    page.setDefaultNavigationTimeout(60000);

    await page.setRequestInterception(true);
    page.on('request', (r) => {
      try {
        const url = r.url();
        if (url && (url.startsWith('http://') || url.startsWith('https://'))) {
          const type = r.resourceType();
          if (type === 'font' || type === 'media') return r.abort();
        }
      } catch (_) {}
      return r.continue();
    });

    await page.setContent(html, { waitUntil: 'domcontentloaded', timeout: 60000 });

    const pdfOptions = {
      ...(defaultPdfOptions || {}),
      ...(options || {}),
    };

    const autoHeight = !!pdfOptions.autoHeight;
    const autoHeightPadding = !isNaN(Number(pdfOptions.autoHeightPadding)) ? Number(pdfOptions.autoHeightPadding) : 0;
    const scaleToFitWidth = !!pdfOptions.scaleToFitWidth;
    const thermal = !!pdfOptions.thermal;
    const viewportWidth = !isNaN(Number(pdfOptions.viewportWidth)) ? Number(pdfOptions.viewportWidth) : null;
    const viewportHeight = !isNaN(Number(pdfOptions.viewportHeight)) ? Number(pdfOptions.viewportHeight) : null;

    delete pdfOptions.autoHeight;
    delete pdfOptions.autoHeightPadding;
    delete pdfOptions.scaleToFitWidth;
    delete pdfOptions.thermal;
    delete pdfOptions.viewportWidth;
    delete pdfOptions.viewportHeight;

    if (pdfOptions.width || pdfOptions.height) {
      delete pdfOptions.format;
    }

    const widthMm = (() => {
      try {
        if (typeof pdfOptions.width !== 'string') return null;
        const s = String(pdfOptions.width).trim().toLowerCase();
        if (!s.endsWith('mm')) return null;
        const n = Number(s.replace('mm', '').trim());
        return Number.isFinite(n) ? n : null;
      } catch (_) {
        return null;
      }
    })();

    if (viewportWidth != null) {
      await page.setViewport({ width: viewportWidth, height: viewportHeight != null ? viewportHeight : 800 });
    } else if (!scaleToFitWidth && thermal && widthMm != null) {
      const px = Math.max(1, Math.ceil((widthMm * 96) / 25.4));
      await page.setViewport({ width: px, height: 800 });
    }

    if (scaleToFitWidth && widthMm != null) {
      const contentWidthPx = await page.evaluate(() => {
        const b = document.body;
        const d = document.documentElement;
        const w = Math.max(
          b ? b.scrollWidth : 0,
          d ? d.scrollWidth : 0,
          b ? b.offsetWidth : 0,
          d ? d.offsetWidth : 0
        );
        return Math.ceil(w);
      });

      const targetWidthPx = Math.max(1, Math.ceil((widthMm * 96) / 25.4));
      if (Number.isFinite(contentWidthPx) && contentWidthPx > 0) {
        const ratio = targetWidthPx / contentWidthPx;
        const fitted = Math.max(0.1, Math.min(1, ratio));
        const existing = !isNaN(Number(pdfOptions.scale)) ? Number(pdfOptions.scale) : null;
        pdfOptions.scale = existing == null ? fitted : Math.max(0.1, Math.min(existing, fitted));
      }
    }

    if (autoHeight) {
      const contentHeightPx = await page.evaluate(() => {
        const b = document.body;
        const d = document.documentElement;
        const h = Math.max(
          b ? b.scrollHeight : 0,
          d ? d.scrollHeight : 0,
          b ? b.offsetHeight : 0,
          d ? d.offsetHeight : 0
        );
        return Math.ceil(h);
      });
      const heightPx = Math.max(1, Math.ceil(Number(contentHeightPx || 1) + autoHeightPadding));
      const effectiveScale = !isNaN(Number(pdfOptions.scale)) ? Number(pdfOptions.scale) : 1;
      const heightIn = (heightPx / 96) * effectiveScale;
      pdfOptions.height = `${heightIn}in`;
      delete pdfOptions.format;
    }

    const pdfBuffer = await page.pdf(pdfOptions);

    return pdfBuffer;
  } finally {
    await browser.close();
  }
}
