const { createModel } = require('../lib/createModel');

// Fields: name, email, phone, message, createdAt. Public homepage "get in
// touch" form - distinct from Feedback (post-trip/app feedback, see
// models/Feedback.js) since these come from visitors who haven't
// necessarily used the service yet. See routes/enquiry.js.
const Enquiry = createModel('Enquiry');

module.exports = Enquiry;
