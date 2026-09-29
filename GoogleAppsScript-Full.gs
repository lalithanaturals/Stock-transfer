/**
 * Lalitha Naturals - Branch Transfer
 * COMPLETE Google Apps Script backend for the app — transit ledger, shared catalog,
 * and stock snapshots, all in one file. Use this if you're setting up fresh, or want
 * to replace whatever script currently sits behind GOOGLE_SCRIPT_URL with one file
 * that does everything (instead of the two separate "add-on" files sent earlier).
 *
 * ------------------------------------------------------------------------
 * HOW TO INSTALL
 * ------------------------------------------------------------------------
 * 1. Go to sheets.google.com and create a new blank spreadsheet (or open the one
 *    you're already using for this app).
 * 2. Extensions > Apps Script. This opens the script editor, already linked to
 *    that spreadsheet.
 * 3. Delete whatever's in the default Code.gs file and paste in EVERYTHING below
 *    this comment block.
 * 4. (Optional but recommended) Change CATALOG_SECRET below to a password only
 *    you know.
 * 5. Click Deploy (top right) > New deployment.
 *    - Click the gear icon next to "Select type" > Web app.
 *    - Description: anything, e.g. "Branch Transfer backend".
 *    - Execute as: Me.
 *    - Who has access: Anyone.
 *    - Click Deploy. Google will ask you to authorize — allow it (it's your own
 *      script accessing your own sheet).
 * 6. Copy the Web App URL it gives you (ends in /exec).
 * 7. Open index.html, find the line near the top of the <script> section:
 *        const GOOGLE_SCRIPT_URL = "...";
 *    Replace the URL with the one you just copied. Re-upload index.html to GitHub.
 * 8. (Optional) For the low-stock email: change LOW_STOCK_EMAIL below, then in the
 *    Apps Script editor click the clock icon ("Triggers") > + Add Trigger > choose
 *    function sendLowStockDigest > Event source: Time-driven > Day timer > pick a
 *    time > Save.
 *
 * That's it — this one script handles everything the app needs: dispatching and
 * receiving transfers, the shared catalog (Add Item / Categories / Import-Export
 * all sync through it), and the shelf-count snapshots behind the low-stock digest.
 *
 * If you're REPLACING an existing script that already has transit records you
 * care about, don't start from a blank sheet — this script auto-creates its own
 * "Transits" tab and won't see rows saved in a different format by old code.
 * Ask me first if you want your existing data carried over.
 * ------------------------------------------------------------------------
 */

const CATALOG_SECRET = 'change-me';       // optional — see note near handleCatalogPost_
const LOW_STOCK_EMAIL = 'you@example.com'; // for the optional daily digest

// ============================================================================
// Entry points
// ============================================================================

function doGet(e) {
  const type = e.parameter && e.parameter.type;
  if (type === 'catalog') return handleCatalogGet_();
  if (type === 'settings') return handleSettingsGet_();
  return handleTransitsGet_();
}

function doPost(e) {
  let data;
  try {
    data = JSON.parse(e.postData.contents);
  } catch (err) {
    return jsonOut_({ ok: false, error: 'Could not parse request body as JSON' });
  }

  if (data.type === 'catalog') return handleCatalogPost_(data);
  if (data.type === 'settings') return handleSettingsPost_(data);
  if (data.type === 'stockSnapshot') return handleSnapshotPost_(data);
  if (data.type === 'transit') return handleTransitPost_(data);

  return jsonOut_({ ok: false, error: 'Unknown type: ' + data.type });
}

function jsonOut_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

// ============================================================================
// Transit ledger (dispatch / receive / edit / delete)
// One row per transit record: [Id, JSON, LastUpdated]. The whole record — src,
// dst, staff, notes, auditMode, time, status, items[], mismatch, etc. — is kept
// as one JSON blob per row, since its shape can grow without needing new columns.
// ============================================================================

function getTransitsSheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName('Transits');
  if (!sheet) {
    sheet = ss.insertSheet('Transits');
    sheet.appendRow(['Id', 'JSON', 'LastUpdated']);
  }
  return sheet;
}

function handleTransitsGet_() {
  const sheet = getTransitsSheet_();
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return jsonOut_([]);

  const rows = sheet.getRange(2, 1, lastRow - 1, 2).getValues();
  const records = [];
  rows.forEach(r => {
    if (!r[1]) return;
    try { records.push(JSON.parse(r[1])); } catch (e) { /* skip a corrupted row */ }
  });
  return jsonOut_(records);
}

function findTransitRow_(sheet, id) {
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return -1;
  const ids = sheet.getRange(2, 1, lastRow - 1, 1).getValues();
  for (let i = 0; i < ids.length; i++) {
    if (String(ids[i][0]) === String(id)) return i + 2; // +2: header row + 1-indexing
  }
  return -1;
}

function handleTransitPost_(data) {
  const sheet = getTransitsSheet_();

  if (data.action === 'save_transit' && data.transit && data.transit.id) {
    const row = findTransitRow_(sheet, data.transit.id);
    const json = JSON.stringify(data.transit);
    if (row === -1) {
      sheet.appendRow([data.transit.id, json, new Date()]);
    } else {
      sheet.getRange(row, 2, 1, 2).setValues([[json, new Date()]]);
    }
    return jsonOut_({ ok: true });
  }

  if (data.action === 'delete_transit' && data.transitId) {
    const row = findTransitRow_(sheet, data.transitId);
    if (row !== -1) sheet.deleteRow(row);
    return jsonOut_({ ok: true });
  }

  return jsonOut_({ ok: false, error: 'Unknown transit action: ' + data.action });
}

// ============================================================================
// Shared catalog (Add Item / Categories / Existing Items / Import-Export all
// sync through this). Stored as one JSON blob in Script Properties — simplest
// option for something this size (the whole catalog, easily well under the
// property size limit).
// ============================================================================

const CATALOG_PROP_KEY = 'LALITHA_SHARED_CATALOG';

function handleCatalogGet_() {
  const props = PropertiesService.getScriptProperties();
  const raw = props.getProperty(CATALOG_PROP_KEY);
  return jsonOut_({ catalog: raw ? JSON.parse(raw) : null });
}

function handleCatalogPost_(data) {
  // The secret check is optional protection against someone else who gets hold of
  // your script URL overwriting your catalog. Leave CATALOG_SECRET as 'change-me'
  // and this check effectively does nothing extra (every request will still need
  // to send that same placeholder), but for it to actually protect anything, set
  // your own secret above AND add `secret: CATALOG_SECRET` to the body built in
  // pushCatalogToCloud() inside index.html.
  if (CATALOG_SECRET !== 'change-me' && data.secret !== CATALOG_SECRET) {
    return jsonOut_({ ok: false, error: 'bad secret' });
  }
  if (data.action === 'save_catalog' && data.catalog && typeof data.catalog === 'object') {
    PropertiesService.getScriptProperties().setProperty(CATALOG_PROP_KEY, JSON.stringify(data.catalog));
    return jsonOut_({ ok: true });
  }
  return jsonOut_({ ok: false, error: 'Unknown catalog action: ' + data.action });
}

// ============================================================================
// Shared settings — vendors (with their brand/category/item picks) and the
// hide/show toggles (brands, categories, per-brand & per-vendor categories).
// Kept as its own Script Property, separate from the catalog blob, so one
// device's vendor/hide edits show up on another device without waiting for
// a full catalog change. The app polls this on a timer plus on focus/open,
// so changes appear on the other device within ~15-20 seconds (not a live
// push — Apps Script has no websocket/notification channel — but close).
// ============================================================================

const SETTINGS_PROP_KEY = 'LALITHA_SHARED_SETTINGS';

function handleSettingsGet_() {
  const props = PropertiesService.getScriptProperties();
  const raw = props.getProperty(SETTINGS_PROP_KEY);
  return jsonOut_({ settings: raw ? JSON.parse(raw) : null });
}

function handleSettingsPost_(data) {
  if (CATALOG_SECRET !== 'change-me' && data.secret !== CATALOG_SECRET) {
    return jsonOut_({ ok: false, error: 'bad secret' });
  }
  if (data.action === 'save_settings' && data.settings && typeof data.settings === 'object') {
    PropertiesService.getScriptProperties().setProperty(SETTINGS_PROP_KEY, JSON.stringify(data.settings));
    return jsonOut_({ ok: true });
  }
  return jsonOut_({ ok: false, error: 'Unknown settings action: ' + data.action });
}

// ============================================================================
// Stock snapshots ("Save Today's Shelf Count") + low-stock digest
// ============================================================================

function getSnapshotsSheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName('StockSnapshots');
  if (!sheet) {
    sheet = ss.insertSheet('StockSnapshots');
    sheet.appendRow(['Date', 'Time', 'Branch', 'AuditMode', 'ItemID', 'Name', 'Category', 'UOM', 'Code', 'Min', 'Stock', 'Need']);
  }
  return sheet;
}

function handleSnapshotPost_(data) {
  if (!data.branch || !Array.isArray(data.items)) {
    return jsonOut_({ ok: false, error: 'missing branch/items' });
  }
  const sheet = getSnapshotsSheet_();
  const date = data.date || Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');
  const time = data.time || Date.now();
  const rows = data.items.map(i => [date, time, data.branch, data.auditMode || '', i.id, i.name, i.cat, i.uom, i.code, i.min, i.stock, i.need]);
  if (rows.length) sheet.getRange(sheet.getLastRow() + 1, 1, rows.length, rows[0].length).setValues(rows);
  return jsonOut_({ ok: true, rows: rows.length });
}

/**
 * Run manually to test, or put on a daily time-driven trigger (see install step 8
 * above). Emails items below Min, using each branch's latest snapshot saved TODAY.
 * A branch that never tapped "Save Today's Shelf Count" today is simply skipped.
 */
function sendLowStockDigest() {
  const sheet = getSnapshotsSheet_();
  if (sheet.getLastRow() < 2) return;

  const data = sheet.getRange(2, 1, sheet.getLastRow() - 1, 12).getValues();
  const today = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');
  const todaysRows = data.filter(r => r[0] === today);

  const latestTimeByBranch = {};
  todaysRows.forEach(r => {
    const branch = r[2], time = r[1];
    if (!latestTimeByBranch[branch] || time > latestTimeByBranch[branch]) latestTimeByBranch[branch] = time;
  });

  if (Object.keys(latestTimeByBranch).length === 0) {
    MailApp.sendEmail(LOW_STOCK_EMAIL, 'Lalitha Naturals — Low Stock Digest', "No branch saved a shelf count today, so there's nothing to report.");
    return;
  }

  const lowStockByBranch = {};
  todaysRows.forEach(r => {
    const [, time, branch, , , name, , uom, , min, stock, need] = r;
    if (time !== latestTimeByBranch[branch]) return;
    if (need > 0) {
      if (!lowStockByBranch[branch]) lowStockByBranch[branch] = [];
      lowStockByBranch[branch].push(`${name} (${uom}) — stock ${stock}, min ${min}, need ${need}`);
    }
  });

  let body = '';
  Object.keys(latestTimeByBranch).forEach(branch => {
    const items = lowStockByBranch[branch] || [];
    body += `${branch}:\n`;
    body += items.length ? items.map(i => `  - ${i}`).join('\n') : '  (nothing below minimum)';
    body += '\n\n';
  });

  MailApp.sendEmail(LOW_STOCK_EMAIL, 'Lalitha Naturals — Low Stock Digest', body.trim());
}
