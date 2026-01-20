import React, { useEffect, useMemo, useRef, useState } from 'react';
import { getDocument, GlobalWorkerOptions } from 'pdfjs-dist';
import PdfWorker from 'pdfjs-dist/build/pdf.worker.mjs?worker';

import { DownloadIcon, TicketIcon } from './icons';
import { getAgentHeaders, getAgentMetadata } from '@/utils/agentHeaders';

(GlobalWorkerOptions as any).workerPort = new (PdfWorker as any)();

const API_BASE_URL = (() => {
  const raw = String((import.meta as any).env?.VITE_API_BASE_URL || '/api').replace(/\/+$/, '');
  if (!raw) return '/api';
  if (/\/api(\/|$)/i.test(raw)) return raw;
  return `${raw}/api`;
})();

const isPdfMagicBytes = (buf: ArrayBuffer): boolean => {
  const head = new Uint8Array(buf.slice(0, 5));
  return head.length >= 4 && head[0] === 0x25 && head[1] === 0x50 && head[2] === 0x44 && head[3] === 0x46;
};

const bufferToSnippet = (buf: ArrayBuffer, maxChars = 200): string => {
  try {
    const bytes = new Uint8Array(buf.slice(0, Math.max(0, maxChars * 2)));
    const text = new TextDecoder('utf-8', { fatal: false }).decode(bytes);
    return String(text || '').replace(/\s+/g, ' ').trim().slice(0, maxChars);
  } catch {
    return '';
  }
};

const getPnrFromPathname = (): string | null => {
  if (typeof window === 'undefined') return null;
  const path = window.location.pathname || '';
  const parts = path.split('/').filter(Boolean);
  if (parts.length < 2) return null;
  if (parts[0] !== 'tickets') return null;
  try {
    return decodeURIComponent(parts[1] || '');
  } catch {
    return parts[1] || null;
  }
};

const getTicketTypeFromLocation = (): 'final' | 'hold' | null => {
  if (typeof window === 'undefined') return null;
  try {
    const qs = window.location.search || '';
    const usp = new URLSearchParams(qs);
    const raw = (usp.get('type') || usp.get('ticketType') || usp.get('ticket_type') || '').toLowerCase().trim();
    if (raw === 'final' || raw === 'eticket') return 'final';
    if (raw === 'hold' || raw === 'reserved') return 'hold';
    return null;
  } catch {
    return null;
  }
};

const buildUrlWithAgent = (basePath: string, params: Record<string, string | undefined | null>) => {
  const usp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v == null) continue;
    const s = String(v);
    if (!s) continue;
    usp.set(k, s);
  }

  const agent = getAgentMetadata();
  if (agent && agent.agentMode === 'true') {
    usp.set('agentMode', 'true');
    if (agent.agentEmail) usp.set('agentEmail', agent.agentEmail);
    if (agent.agentId) usp.set('agentId', agent.agentId);
    if (agent.agentName) usp.set('agentName', agent.agentName);
  }

  const qs = usp.toString();
  return qs ? `${basePath}?${qs}` : basePath;
};

const ViewTicketsPage: React.FC = () => {
  const initialPnr = useMemo(() => getPnrFromPathname() || '', []);
  const initialType = useMemo(() => getTicketTypeFromLocation(), []);

  const [pnr, setPnr] = useState(initialPnr);
  const [pnrInput, setPnrInput] = useState(initialPnr);
  const [ticketType] = useState<'final' | 'hold' | null>(initialType);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pdfObjectUrl, setPdfObjectUrl] = useState<string | null>(null);
  const [pdfScale, setPdfScale] = useState(1);
  const [pdfRenderTick, setPdfRenderTick] = useState(0);
  const [pdfRenderError, setPdfRenderError] = useState<string | null>(null);
  const [pdfRendering, setPdfRendering] = useState(false);
  const pdfContainerRef = useRef<HTMLDivElement | null>(null);
  const [downloadBusy, setDownloadBusy] = useState<'pdf' | null>(null);
  const [downloadError, setDownloadError] = useState<string | null>(null);

  const downloadPnr = useMemo(() => {
    const a = (pnr || '').trim();
    if (a) return a;
    return (pnrInput || '').trim();
  }, [pnr, pnrInput]);

  const pdfEndpoint = useMemo(() => {
    if (!pnr) return null;
    return buildUrlWithAgent(`${API_BASE_URL}/ticket/pdf`, { pnr, type: ticketType });
  }, [pnr, ticketType]);

  const downloadEndpoint = useMemo(() => {
    if (!downloadPnr) return null;
    return buildUrlWithAgent(`${API_BASE_URL}/ticket/pdf`, { pnr: downloadPnr, download: '1', type: ticketType });
  }, [downloadPnr, ticketType]);

  const downloadFromEndpoint = async (endpoint: string, fallbackFilename: string) => {
    try {
      setDownloadError(null);
      setDownloadBusy('pdf');

      const res = await fetch(endpoint, {
        credentials: 'include',
        headers: { ...getAgentHeaders() },
      });

      if (!res.ok) {
        if (res.status === 404) {
          throw new Error('Ticket not available yet. Please try again later.');
        }
        try {
          const t = await res.text();
          if (t && String(t).trim()) throw new Error(String(t).trim());
        } catch {
          // ignore
        }
        throw new Error('Failed to download ticket. Please try again later.');
      }

      const cd = res.headers.get('content-disposition') || '';
      let filename = fallbackFilename;

      const utf8Match = cd.match(/filename\*=UTF-8''([^;]+)/i);
      if (utf8Match && utf8Match[1]) {
        try {
          filename = decodeURIComponent(utf8Match[1]);
        } catch {
          filename = utf8Match[1];
        }
      } else {
        const simpleMatch = cd.match(/filename="?([^";]+)"?/i);
        if (simpleMatch && simpleMatch[1]) {
          filename = simpleMatch[1];
        }
      }

      const contentType = (res.headers.get('content-type') || '').toLowerCase();
      const buf = await res.arrayBuffer();

      if (res.status === 204 || buf.byteLength === 0) {
        throw new Error('No ticket PDF available yet for this PNR. Please try again later.');
      }

      const looksLikePdf =
        contentType.includes('application/pdf') ||
        contentType.includes('application/octet-stream') ||
        /pdf/i.test(cd) ||
        isPdfMagicBytes(buf);

      if (!looksLikePdf) {
        const snippet = bufferToSnippet(buf);
        throw new Error(
          `Unexpected response when downloading ticket PDF from ${endpoint} (status ${res.status}, content-type ${contentType || 'unknown'})${snippet ? `: ${snippet}` : ''}`
        );
      }

      const blob = new Blob([buf], { type: 'application/pdf' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename || fallbackFilename;
      a.rel = 'noopener';
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (e: any) {
      setDownloadError(e?.message || 'Download failed');
    } finally {
      setDownloadBusy(null);
    }
  };

  useEffect(() => {
    if (!pdfEndpoint) return;

    const controller = new AbortController();

    const loadPdf = async () => {
      try {
        setLoading(true);
        setError(null);

        const endpoint = pdfEndpoint;
        const res = await fetch(endpoint, {
          signal: controller.signal,
          credentials: 'include',
          headers: { ...getAgentHeaders() },
        });

        if (!res.ok) {
          if (res.status === 404) {
            throw new Error('Ticket not available yet. Please try again later.');
          }
          try {
            const t = await res.text();
            if (t && String(t).trim()) throw new Error(String(t).trim());
          } catch {
            // ignore
          }
          throw new Error('Failed to load ticket. Please try again later.');
        }

        const contentType = (res.headers.get('content-type') || '').toLowerCase();
        const cd = res.headers.get('content-disposition') || '';
        const buf = await res.arrayBuffer();
        const snippet = bufferToSnippet(buf);

        if (res.status === 204 || buf.byteLength === 0) {
          throw new Error(
            `No ticket PDF available yet (status ${res.status}, content-type ${contentType || 'unknown'})${snippet ? `: ${snippet}` : ''}`
          );
        }

        const looksLikePdf =
          contentType.includes('application/pdf') ||
          contentType.includes('application/octet-stream') ||
          /pdf/i.test(cd) ||
          isPdfMagicBytes(buf);

        if (!looksLikePdf) {
          throw new Error(
            `Unexpected response when loading ticket PDF (status ${res.status}, content-type ${contentType || 'unknown'})${snippet ? `: ${snippet}` : ''}`
          );
        }

        const blob = new Blob([buf], { type: 'application/pdf' });
        const objectUrl = URL.createObjectURL(blob);

        setPdfObjectUrl((prev) => {
          if (prev && prev.startsWith('blob:')) URL.revokeObjectURL(prev);
          return objectUrl;
        });

      } catch (e: any) {
        if (controller.signal.aborted) return;
        setPdfObjectUrl((prev) => {
          if (prev && prev.startsWith('blob:')) URL.revokeObjectURL(prev);
          return null;
        });
        setError(e?.message || 'Failed to load ticket PDF');
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    };

    loadPdf();

    return () => {
      controller.abort();
      setPdfObjectUrl((prev) => {
        if (prev && prev.startsWith('blob:')) URL.revokeObjectURL(prev);
        return null;
      });
    };
  }, [pdfEndpoint]);

  useEffect(() => {
    if (!pdfObjectUrl) return;
    const container = pdfContainerRef.current;
    if (!container) return;

    let cancelled = false;
    setPdfRenderError(null);
    setPdfRendering(true);

    while (container.firstChild) {
      container.removeChild(container.firstChild);
    }

    const loadingTask: any = getDocument({ url: pdfObjectUrl });

    const getInnerWidth = (el: HTMLElement) => {
      const rect = el.getBoundingClientRect();
      let w = rect.width;
      try {
        const cs = window.getComputedStyle(el);
        const pl = parseFloat(cs.paddingLeft || '0') || 0;
        const pr = parseFloat(cs.paddingRight || '0') || 0;
        w = Math.max(1, w - pl - pr);
      } catch {
        w = Math.max(1, w);
      }
      return Math.max(1, w);
    };

    const run = async () => {
      try {
        const pdf: any = await loadingTask.promise;
        if (cancelled) return;

        const pageCount = Number(pdf?.numPages) || 1;
        for (let pageNumber = 1; pageNumber <= pageCount; pageNumber++) {
          if (cancelled) break;
          const page: any = await pdf.getPage(pageNumber);
          if (cancelled) break;

          const containerWidth = getInnerWidth(container);
          const viewportAt1 = page.getViewport({ scale: 1 });
          const fitScale = containerWidth / Math.max(1, viewportAt1.width);
          const displayScale = Math.max(0.1, fitScale * pdfScale);
          const dpr = (typeof window !== 'undefined' && window.devicePixelRatio) ? window.devicePixelRatio : 1;
          const viewport = page.getViewport({ scale: displayScale * dpr });
          const canvas = document.createElement('canvas');
          const ctx = canvas.getContext('2d');
          if (!ctx) continue;

          canvas.width = Math.floor(viewport.width);
          canvas.height = Math.floor(viewport.height);
          canvas.style.display = 'block';
          canvas.style.margin = '0 auto';
          canvas.style.width = `${Math.max(1, Math.floor(viewport.width / dpr))}px`;
          canvas.style.height = `${Math.max(1, Math.floor(viewport.height / dpr))}px`;
          container.appendChild(canvas);

          const renderTask: any = page.render({ canvasContext: ctx, viewport });
          await renderTask.promise;
        }
      } catch (e: any) {
        if (cancelled) return;
        setPdfRenderError(e?.message || 'Failed to render PDF preview');
      } finally {
        if (!cancelled) setPdfRendering(false);
      }
    };

    run();

    return () => {
      cancelled = true;
      try {
        loadingTask?.destroy?.();
      } catch {}
    };
  }, [pdfObjectUrl, pdfScale, pdfRenderTick]);

  useEffect(() => {
    const el = pdfContainerRef.current;
    if (!el) return;
    if (typeof window === 'undefined') return;

    let raf: number | null = null;
    let lastWidth = 0;

    const getInnerWidth = (node: HTMLElement) => {
      const rect = node.getBoundingClientRect();
      let w = rect.width;
      try {
        const cs = window.getComputedStyle(node);
        const pl = parseFloat(cs.paddingLeft || '0') || 0;
        const pr = parseFloat(cs.paddingRight || '0') || 0;
        w = Math.max(1, w - pl - pr);
      } catch {
        w = Math.max(1, w);
      }
      return Math.max(1, w);
    };

    const trigger = () => {
      if (raf != null) cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        raf = null;
        const node = pdfContainerRef.current;
        if (!node) return;
        const w = Math.round(getInnerWidth(node));
        if (Math.abs(w - lastWidth) > 1) {
          lastWidth = w;
          setPdfRenderTick((v) => v + 1);
        }
      });
    };

    trigger();

    let ro: ResizeObserver | null = null;
    try {
      ro = new ResizeObserver(() => trigger());
      ro.observe(el);
    } catch {
      // ignore
    }

    window.addEventListener('resize', trigger);

    return () => {
      if (raf != null) cancelAnimationFrame(raf);
      window.removeEventListener('resize', trigger);
      if (ro) ro.disconnect();
    };
  }, []);

  const handleLookup = () => {
    const next = (pnrInput || '').trim();
    if (!next) return;
    const url = `/tickets/${encodeURIComponent(next)}`;
    window.location.href = url;
  };

  const handleBackHome = () => {
    window.location.href = '/';
  };

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
      <div className="max-w-5xl mx-auto p-4 md:p-6">
        <div className="flex items-start justify-between gap-4 mb-4">
          <div className="flex items-center gap-3">
            <div className="flex items-center justify-center h-10 w-10 rounded-full bg-[#652D8E]/10">
              <TicketIcon className="h-5 w-5 text-[#652D8E] dark:text-purple-300" />
            </div>
            <div>
              <h1 className="text-xl font-bold text-[#652D8E] dark:text-purple-300">View ticket(s)</h1>
              <p className="mt-0.5 text-xs text-gray-600 dark:text-gray-400">Enter your PNR / reference code to open your PDF tickets.</p>
            </div>
          </div>

          <button
            type="button"
            onClick={handleBackHome}
            className="btn-primary px-3 py-1.5 text-xs"
          >
            Home
          </button>
        </div>

        <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl p-4">
          <div className="flex flex-col sm:flex-row sm:items-end gap-2">
            <div className="flex-1">
              <label className="block text-xs font-semibold text-gray-700 dark:text-gray-200">PNR / Reference</label>
              <input
                value={pnrInput}
                onChange={(e) => setPnrInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleLookup();
                }}
                placeholder="e.g. 6c7a..."
                className="mt-1 w-full rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 px-3 py-2 text-sm text-gray-900 dark:text-gray-100"
              />
            </div>
            <button
              type="button"
              onClick={() => {
                setPnr((pnrInput || '').trim());
                handleLookup();
              }}
              className="btn-primary px-4 py-2 text-xs"
            >
              Open
            </button>
            {downloadEndpoint && (
              <button
                type="button"
                onClick={() => downloadFromEndpoint(downloadEndpoint, `tickets-${downloadPnr || 'download'}.pdf`)}
                disabled={downloadBusy !== null}
                className="inline-flex items-center justify-center gap-1.5 rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 px-4 py-2 text-xs font-semibold text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-800"
              >
                <DownloadIcon className="h-4 w-4" />
                {downloadBusy === 'pdf' ? 'Downloading…' : 'Download'}
              </button>
            )}
          </div>

          {downloadError ? (
            <div className="mt-2 text-[11px] text-red-700 dark:text-red-300">{downloadError}</div>
          ) : null}

          {pnr ? (
            <div className="mt-2 text-[11px] text-gray-600 dark:text-gray-400">
              Showing: <span className="font-mono">{pnr}</span>
            </div>
          ) : null}
        </div>

        <div className="mt-4">
          {loading && (
            <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl p-4 text-sm text-gray-600 dark:text-gray-300">
              Loading ticket PDF...
            </div>
          )}

          {error && !loading && (
            <div className="bg-white dark:bg-gray-800 border border-red-200 dark:border-red-800 rounded-xl p-4">
              <div className="text-sm font-semibold text-red-700 dark:text-red-300">Could not load ticket PDF</div>
              <div className="mt-1 text-xs text-red-700/90 dark:text-red-300/90">{error}</div>
              {pdfEndpoint && (
                <div className="mt-3 flex flex-wrap gap-2">
                  <a
                    href={pdfEndpoint}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="btn-primary px-3 py-1.5 text-xs"
                  >
                    Try opening in new tab
                  </a>
                </div>
              )}
            </div>
          )}

          {!loading && !error && pdfObjectUrl && (
            <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl overflow-hidden">
              <div className="px-4 py-3 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between">
                <div className="text-xs font-semibold text-gray-900 dark:text-gray-100">Ticket PDF preview</div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setPdfScale((v) => Math.max(0.6, Math.round((v - 0.1) * 10) / 10))}
                    className="inline-flex items-center justify-center rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 px-3 py-1.5 text-xs font-semibold text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-800"
                    aria-label="Zoom out"
                  >
                    −
                  </button>
                  <div className="text-[11px] text-gray-600 dark:text-gray-300 min-w-[52px] text-center" aria-live="polite">
                    {Math.round(pdfScale * 100)}%
                  </div>
                  <button
                    type="button"
                    onClick={() => setPdfScale((v) => Math.min(2.0, Math.round((v + 0.1) * 10) / 10))}
                    className="inline-flex items-center justify-center rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 px-3 py-1.5 text-xs font-semibold text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-800"
                    aria-label="Zoom in"
                  >
                    +
                  </button>
                  {pdfEndpoint && (
                    <button
                      type="button"
                      onClick={() => window.open(`${pdfEndpoint}#zoom=page-width`, '_blank', 'noopener,noreferrer')}
                      className="inline-flex items-center justify-center rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 px-3 py-1.5 text-xs font-semibold text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-800"
                    >
                      Open
                    </button>
                  )}
                </div>
              </div>
              <div className="h-[75vh]">
                <div className="w-full h-full overflow-auto bg-gray-50 dark:bg-gray-900/40">
                  {pdfRendering ? (
                    <div className="p-4 text-xs text-gray-600 dark:text-gray-300">Rendering PDF…</div>
                  ) : null}
                  {pdfRenderError ? (
                    <div className="p-4">
                      <div className="text-xs font-semibold text-red-700 dark:text-red-300">Could not render PDF preview</div>
                      <div className="mt-1 text-[11px] text-red-700/90 dark:text-red-300/90">{pdfRenderError}</div>
                    </div>
                  ) : null}
                  <div ref={pdfContainerRef} className="p-4" />
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default ViewTicketsPage;
