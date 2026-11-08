const { takeRange } = require('./range');
exports.page = (items, start, count) => {
  if (!count) return [];
  return takeRange(items, start, start + count - 1);
};
