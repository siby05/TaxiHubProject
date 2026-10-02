// Bridge to the EasyRide Driver Android app (android-driver-app/), which
// shows this same website in a WebView and exposes a few native helpers as
// window.EasyRideApp. Everything here falls back to the normal browser
// behaviour, so the website works the same as before outside the app.

function bridge() {
  return typeof window !== 'undefined' ? window.EasyRideApp : undefined;
}

export function isDriverApp() {
  return !!bridge();
}

// Prints the current page (WebView ignores window.print()).
export function printPage() {
  const app = bridge();
  if (app) app.printPage();
  else window.print();
}

// Prints a standalone HTML document. In a browser it opens in a new tab
// and prints from there (returns false if pop-ups are blocked).
export function printHtml(html, title) {
  const app = bridge();
  if (app) {
    app.printHtml(html, title || document.title);
    return true;
  }
  const w = window.open('', '_blank');
  if (!w) return false;
  w.document.write(html.replace('</body>', '<script>window.onload=()=>window.print()</script></body>'));
  w.document.close();
  return true;
}

// Saves a text file (e.g. CSV). In the app the driver picks where to save
// it; in a browser it downloads as usual.
export function saveTextFile(filename, mimeType, text) {
  const app = bridge();
  if (app) {
    app.saveTextFile(filename, mimeType, text);
    return;
  }
  const url = URL.createObjectURL(new Blob([text], { type: mimeType }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
