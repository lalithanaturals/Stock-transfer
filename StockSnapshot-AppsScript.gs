/**
 * Lalitha Naturals - Branch Transfer
 * SECOND ADD-ON for your existing Apps Script (goes alongside CatalogSync-AppsScript.gs
 * from before, in the same project). This one:
 *
 *   1. Stores every "Save Today's Shelf Count" tap from the app into a sheet tab
 *      called "StockSnapshots" — so current stock actually lives somewhere central,
 *      not just in whichever phone happens to have it open right now.
 *   2. Adds a daily low-stock email, built on top of that data.
 *
 * ------------------------------------------------------------------------
 * HOW TO INSTALL
 * ------------------------------------------------------------------------
 * 1. Open the same Apps Script project as before (script.google.com, the one behind
 *    GOOGLE_SCRIPT_URL).
 * 2. Add a new file, name it "StockSnapshot", and paste everything below the dashes.
 * 3. In your EXISTING doPost(e), add this alongside the "catalog" check you added
 *    earlier:
 *
 *       if (data.type === 'stockSnapshot') return handleSnapshotPost_(data);
 *
 *    (again, use whatever variable name your script already uses for the parsed body)
 * 4. Set LOW_STOCK_EMAIL below to the address that should get the daily alert.
 * 5. Click Deploy > Manage deployments > edit (pencil) > New version > Deploy —
 *    same URL as before, nothing to change in index.html.
 * 6. To get the daily email actually running: in the Apps Script editor, click the
 *    clock icon ("Triggers") on the left, "+ Add Trigger", choose function
 *    sendLowStockDigest, event source "Time-driven", "Day timer", pick a time
 *    (e.g. 9am–10am). Save. That's it — no code changes needed for this part.
 *
 * ------------------------------------------------------------------------
 * HOW IT WORKS
 * ------------------------------------------------------------------------
 * Every time someone taps "Save Today's Shelf Count" in the app, it sends the full
 * item list with whatever's currently entered for that branch. This script appends
 * one row per item to StockSnapshots (creating the tab automatically the first time).
 * sendLowStockDigest() looks at, for each branch, the MOST RECENT snapshot saved that
 * day, and emails a summary of every item below its Min.
 *
 * This only reflects reality if staff actually tap "Save Today's Shelf Count" once
 * they've finished an audit — it's not automatic. If a branch never taps it, that
 * branch just won't show up in the digest for that day.
 * ------------------------------------------------------------------------
 */

const LOW_STOCK_EMAIL = 'you@example.com'; // <-- change this

function handleSnapshotPost_(data) {
  if (!data.branch || !Array.isArray(data.items)) {
    return ContentService.createTextOutput(JSON.stringify({ ok: false, error: 'missing branch/items' }))
      .setMimeType(ContentService.MimeType.JSON);
  }

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName('StockSnapshots');
  if (!sheet) {
    sheet = ss.insertSheet('StockSnapshots');
    sheet.appendRow(['Date', 'Time', 'Branch', 'AuditMode', 'ItemID', 'Name', 'Category', 'UOM', 'Code', 'Min', 'Stock', 'Need']);
  }

  const date = data.date || Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');
  const time = data.time || Date.now();
  const rows = data.items.map(i => [date, time, data.branch, data.auditMode || '', i.id, i.name, i.cat, i.uom, i.code, i.min, i.stock, i.need]);
  if (rows.length) {
    sheet.getRange(sheet.getLastRow() + 1, 1, rows.length, rows[0].length).setValues(rows);
  }

  return ContentService.createTextOutput(JSON.stringify({ ok: true, rows: rows.length }))
    .setMimeType(ContentService.MimeType.JSON);
}

/**
 * Run manually any time to test, or on a daily time-driven trigger (see install steps
 * above). Emails a summary of items below Min, using each branch's latest snapshot
 * saved TODAY. Branches with no snapshot saved today are skipped and named at the top
 * of the email so you know their numbers are stale.
 */
function sendLowStockDigest() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName('StockSnapshots');
  if (!sheet || sheet.getLastRow() < 2) return; // nothing saved yet

  const data = sheet.getRange(2, 1, sheet.getLastRow() - 1, 12).getValues();
  const today = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');

  // Keep only today's rows, then the latest snapshot Time per branch.
  const todaysRows = data.filter(r => r[0] === today);
  const latestTimeByBranch = {};
  todaysRows.forEach(r => {
    const branch = r[2], time = r[1];
    if (!latestTimeByBranch[branch] || time > latestTimeByBranch[branch]) latestTimeByBranch[branch] = time;
  });

  const lowStockByBranch = {};
  todaysRows.forEach(r => {
    const [, time, branch, , , name, , uom, , min, stock, need] = r;
    if (time !== latestTimeByBranch[branch]) return; // only the latest snapshot counts
    if (need > 0) {
      if (!lowStockByBranch[branch]) lowStockByBranch[branch] = [];
      lowStockByBranch[branch].push(`${name} (${uom}) — stock ${stock}, min ${min}, need ${need}`);
    }
  });

  const branchesWithData = Object.keys(latestTimeByBranch);
  if (branchesWithData.length === 0) {
    MailApp.sendEmail(LOW_STOCK_EMAIL, 'Lalitha Naturals — Low Stock Digest', 'No branch saved a shelf count today, so there\'s nothing to report.');
    return;
  }

  let body = '';
  branchesWithData.forEach(branch => {
    const items = lowStockByBranch[branch] || [];
    body += `${branch}:\n`;
    body += items.length ? items.map(i => `  - ${i}`).join('\n') : '  (nothing below minimum)';
    body += '\n\n';
  });

  MailApp.sendEmail(LOW_STOCK_EMAIL, 'Lalitha Naturals — Low Stock Digest', body.trim());
}
