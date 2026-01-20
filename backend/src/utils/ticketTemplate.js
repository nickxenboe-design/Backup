export function buildTicketHtml(ticket) {
  const {
    refNo,
    status = 'pending',
    bookedBy = 'online',
    passenger = {},
    itinerary = {},
    seatNo = '-',
    priceText = '-',
    operator = '-',
    qrDataUrl,
  } = ticket || {};

  const passengerName = passenger.name || '-';
  const passengerPhone = passenger.phone || '-';
  const passengerId = passenger.idNumber || '-';

  const {
    departCity = '-',
    departDate = '-',
    departTime = '-',
    arriveCity = '-',
    arriveDate = '-',
    arriveTime = '-',
  } = itinerary || {};

  const normalizedStatus = String(status || '').toLowerCase();
  const isConfirmed = normalizedStatus === 'confirmed';

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <title>Ticket ${escapeHtml(refNo || '')}</title>
  <style>
    * {
      box-sizing: border-box;
      font-family: -apple-system, BlinkMacSystemFont, 'Inter', system-ui, sans-serif;
    }
    body {
      margin: 0;
      padding: 16px;
      background: #f5f3f8;
    }
    .page {
      width: 100%;
    }
    .card {
      max-width: 720px;
      margin: 0 auto;
      background: #ffffff;
      border-radius: 16px;
      border: 1px solid #e5e7eb;
      box-shadow: 0 10px 25px rgba(0,0,0,0.08);
      overflow: hidden;
    }
    .header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 12px 18px;
      border-bottom: 1px solid #e5e7eb;
      background: #faf7fd;
    }
    .brand {
      color: #652D8E;
      font-weight: 700;
      font-size: 15px;
      letter-spacing: 0.02em;
    }
    .status-pill {
      padding: 4px 10px;
      border-radius: 999px;
      font-size: 11px;
      font-weight: 700;
      text-transform: uppercase;
    }
    .status-pill.pending {
      background: #fef9c3;
      color: #854d0e;
    }
    .status-pill.confirmed {
      background: #d1fae5;
      color: #065f46;
    }
    .section {
      padding: 16px 18px;
      border-bottom: 1px solid #e5e7eb;
    }
    .section:last-child {
      border-bottom: none;
    }
    .grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
      gap: 14px;
    }
    .label {
      text-transform: uppercase;
      font-size: 11px;
      letter-spacing: 0.08em;
      color: #6b7280;
      margin-bottom: 4px;
    }
    .value {
      font-size: 14px;
      font-weight: 700;
      color: #111827;
    }
    .muted {
      font-size: 11px;
      color: #6b7280;
      margin-top: 4px;
    }
    .right {
      text-align: right;
    }
    .qr-wrapper {
      text-align: center;
      padding: 12px 0;
    }
    .qr-wrapper img {
      width: 120px;
      height: 120px;
      object-fit: contain;
    }
    .footer {
      font-size: 11px;
      color: #4b5563;
      line-height: 1.45;
      padding: 0 18px 16px 18px;
    }
    .footer-strong {
      font-weight: 600;
      color: #111827;
      margin-bottom: 4px;
    }
  </style>
</head>
<body>
  <div class="page">
    <div class="card">
      <div class="header">
        <div class="brand">National Tickets Global</div>
        <div class="status-pill ${isConfirmed ? 'confirmed' : 'pending'}">
          ${escapeHtml(status || 'PENDING')}
        </div>
      </div>

      <div class="section">
        <div class="grid">
          <div>
            <div class="label">Passenger</div>
            <div class="value">${escapeHtml(passengerName)}</div>
            <div class="muted">Phone: ${escapeHtml(passengerPhone)}</div>
            <div class="muted">ID: ${escapeHtml(passengerId)}</div>
          </div>
          <div class="right">
            <div class="label">Ref No</div>
            <div class="value">${escapeHtml(refNo || '-')}</div>
            <div class="muted">Booked By: ${escapeHtml(bookedBy)}</div>
          </div>
        </div>
      </div>

      <div class="section">
        <div class="grid">
          <div>
            <div class="label">Depart</div>
            <div class="value">${escapeHtml(departCity)}</div>
            <div class="muted">${escapeHtml(departDate)} ${escapeHtml(departTime)}</div>
          </div>
          <div>
            <div class="label">Arrive</div>
            <div class="value">${escapeHtml(arriveCity)}</div>
            <div class="muted">${escapeHtml(arriveDate)} ${escapeHtml(arriveTime)}</div>
          </div>
          <div>
            <div class="label">Seat</div>
            <div class="value">${escapeHtml(seatNo)}</div>
            <div class="muted">Price: ${escapeHtml(priceText)}</div>
            <div class="muted">Operator: ${escapeHtml(operator)}</div>
          </div>
        </div>
      </div>

      ${qrDataUrl ? `
      <div class="section qr-wrapper">
        <img src="${qrDataUrl}" alt="Ticket QR Code" />
      </div>
      ` : ''}

      <div class="footer">
        <div class="footer-strong">
          TICKET ${isConfirmed ? 'CONFIRMED' : 'RESERVED'} - Present this ticket at the station.
        </div>
        <div>Check-in 1 hour before departure. Terms &amp; conditions apply.</div>
        <div>If you have any questions, contact support or your issuing agent.</div>
      </div>
    </div>
  </div>
</body>
</html>`;
}

function escapeHtml(value) {
  if (value == null) return '';
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
