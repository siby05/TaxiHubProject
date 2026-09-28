// Side effects a request doesn't need to wait for (courtesy emails, in-app
// notifications, receipt PDFs) run here instead of inline, so an API call
// answers as soon as its own database write is done - a slow SMTP server
// (send() can spend several seconds retrying on a second port) or a
// broadcast to many drivers never holds up the driver's or passenger's tap.
//
// Jobs start after the current request's response has been handed off
// (setImmediate), at most MAX_CONCURRENT at a time so a burst of work
// can't flood the mail provider or the database connection pool. A job
// that fails is logged and dropped - it never rejects into a route.
const MAX_CONCURRENT = 3;

const queue = [];
let running = 0;

function drain() {
  while (running < MAX_CONCURRENT && queue.length) {
    const { label, fn } = queue.shift();
    running += 1;
    Promise.resolve()
      .then(fn)
      .catch((err) => console.error(`[background] ${label} failed: ${err?.message || err}`))
      .finally(() => {
        running -= 1;
        drain();
      });
  }
}

function runInBackground(label, fn) {
  queue.push({ label, fn });
  setImmediate(drain);
}

module.exports = { runInBackground };
