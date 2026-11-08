exports.names = obj => {
  const result = [];
  for (const key of Object.keys(obj)) if (obj[key] !== null) result.push(key);
  return result;
};
