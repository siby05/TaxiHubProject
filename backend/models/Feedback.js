const { createModel } = require('../lib/createModel');

// Fields: name, email, message, rating (optional 1-5), userId (-> User,
// optional - feedback can be submitted anonymously or logged in).
const Feedback = createModel('Feedback', {
  userId: 'User',
});

module.exports = Feedback;
