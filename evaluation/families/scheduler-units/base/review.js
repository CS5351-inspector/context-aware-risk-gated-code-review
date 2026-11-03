const { after } = require('./scheduler.js');
exports.scheduleRetry = (delayMs) => after(delayMs / 1000);
