// Scheduler API contract: delay is expressed in SECONDS.
exports.after = (delaySeconds) => ({ scheduledAfterSeconds: delaySeconds });
