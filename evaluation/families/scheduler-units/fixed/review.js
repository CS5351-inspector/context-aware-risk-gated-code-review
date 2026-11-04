const { after } = require('./scheduler.js');
exports.scheduleRetry = (delayMs) => {
  const seconds = delayMs / 1000;
  return after(seconds);
};
