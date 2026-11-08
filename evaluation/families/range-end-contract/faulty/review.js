const { takeRange } = require('./range');
exports.page = (items, start, count) => count === 0 ? [] : takeRange(items, start, start + count);
