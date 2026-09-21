/**
 * Lalitha Naturals - Branch Transfer
 * ADD-ON for your existing Google Apps Script (the one behind GOOGLE_SCRIPT_URL
 * in index.html). This is NOT a full replacement — it only adds:
 *
 *   1. A shared catalog store, so an item added/edited/deleted in "Manage
 *      Catalog" on one branch's phone shows up on the other branch's phone
 *      automatically, instead of staying stuck in that phone's local storage.
 *   2. A simple shared-secret check, since your Web App URL is public and
 *      anyone with the link could currently POST to it.
 *
 * ------------------------------------------------------------------------
 * HOW TO INSTALL
 * ------------------------------------------------------------------------
 * 1. Open script.google.com, open the SAME project that already powers
 *    GOOGLE_SCRIPT_URL (Extensions > Apps Script from your Google Sheet,
 *    if you're not sure which project it is).
 * 2. Create a NEW file in that project (File icon > + > Script), name it
 *    "CatalogSync", and paste everything below the line of dashes into it.
 * 3. Open your EXISTING doGet(e) function and add this near the top,
 *    before your current logic runs:
 *
 *       if (e.parameter.type === 'catalog') return handleCatalogGet_(e);
 *
 * 4. Open your EXISTING doPost(e) function and add this near the top,
 *    right after you parse the request body into an object (commonly
 *    called `data` or `body`):
 *
 *       if (data.type === 'catalog') return handleCatalogPost_(data);
 *
 *    (use whatever variable name your script already uses for the parsed
 *    JSON body in place of `data`)
 * 5. Change SHARED_SECRET below to a password only you know, then open
 *    index.html and search for GOOGLE_SCRIPT_URL — right below it, add:
 *
 *       const CATALOG_SECRET = "put-the-same-password-here";
 *
 *    (I left the client-side save call ready to send it — see the note
 *    at the bottom of this file for the one-line client change needed
 *    once you've set your own secret.)
 * 6. Click Deploy > Manage deployments > edit (pencil) icon on your
 *    existing deployment > New version > Deploy. This keeps the same
 *    URL, so you don't need to change GOOGLE_SCRIPT_URL in index.html.
 * 7. Reload the app on both branches' phones once. The first phone to
 *    open "Manage Catalog" and save anything will seed the shared copy;
 *    after that, edits on either phone sync to the other automatically
 *    the next time that phone loads the app.
 *
 * ------------------------------------------------------------------------
 * NOTE ON THE LOW-STOCK EMAIL DIGEST
 * ------------------------------------------------------------------------
 * I've held this one back rather than ship something half-working: this
 * app currently only ever calculates "what's short" during an audit
 * session on a phone, and that number never gets saved anywhere central —
 * it lives in the phone's memory only until a transfer is dispatched. To
 * do a real low-stock digest (e.g. "email me every morning if any item
 * is below its minimum at either branch"), the app would first need a
 * "Save today's shelf count" action that writes each branch's current
 * stock into a sheet, and the digest would read that sheet. That's a
 * bigger feature than a few lines of trigger code, so I didn't want to
 * hand you something that looks automatic but quietly reports stale or
 * missing numbers. Happy to build the shelf-count-saving flow first if
 * you want this — just ask.
 * ------------------------------------------------------------------------
 */

// Change this to any password of your choosing (letters/numbers, no spaces needed).
// Must exactly match CATALOG_SECRET in index.html.
const SHARED_SECRET = 'change-me';

// Name of the Script Property used to store the catalog JSON blob.
const CATALOG_PROP_KEY = 'LALITHA_SHARED_CATALOG';

/**
 * Handles GET ?type=catalog
 * Returns: { catalog: {...} }  or  { catalog: null } if nothing saved yet.
 */
function handleCatalogGet_(e) {
  const props = PropertiesService.getScriptProperties();
  const raw = props.getProperty(CATALOG_PROP_KEY);
  const catalog = raw ? JSON.parse(raw) : null;
  return ContentService
    .createTextOutput(JSON.stringify({ catalog: catalog }))
    .setMimeType(ContentService.MimeType.JSON);
}

/**
 * Handles POST { type: 'catalog', action: 'save_catalog', catalog: {...}, secret: '...' }
 * Silently ignores the write if the secret doesn't match, so a stray/old
 * client (or someone probing the URL) can't overwrite the shared catalog.
 * (The response body isn't readable by the app anyway, since it POSTs with
 * mode: 'no-cors' — this is purely to protect the stored data.)
 */
function handleCatalogPost_(data) {
  if (data.secret !== SHARED_SECRET) {
    return ContentService
      .createTextOutput(JSON.stringify({ ok: false, error: 'bad secret' }))
      .setMimeType(ContentService.MimeType.JSON);
  }
  if (data.action === 'save_catalog' && data.catalog && typeof data.catalog === 'object') {
    const props = PropertiesService.getScriptProperties();
    props.setProperty(CATALOG_PROP_KEY, JSON.stringify(data.catalog));
    return ContentService
      .createTextOutput(JSON.stringify({ ok: true }))
      .setMimeType(ContentService.MimeType.JSON);
  }
  return ContentService
    .createTextOutput(JSON.stringify({ ok: false, error: 'unknown action' }))
    .setMimeType(ContentService.MimeType.JSON);
}

/* ------------------------------------------------------------------------
 * ONE-LINE CLIENT CHANGE (once you've picked your own SHARED_SECRET above)
 * ------------------------------------------------------------------------
 * In index.html, find pushCatalogToCloud() and add "secret: CATALOG_SECRET"
 * to the body it sends, e.g.:
 *
 *   body: JSON.stringify({
 *       type: 'catalog', action: 'save_catalog',
 *       catalog: inventoryData, version: CATALOG_VERSION,
 *       secret: CATALOG_SECRET
 *   })
 *
 * This is optional — the sync works without it, the secret just stops
 * other people from writing to your shared catalog if they ever got hold
 * of your script URL. Send me the word "secret" if you'd like me to wire
 * this line in for you directly.
 * ------------------------------------------------------------------------
 */
