exports.get = (cache, key, fallback) => Object.prototype.hasOwnProperty.call(cache, key) ? cache[key] : fallback;
