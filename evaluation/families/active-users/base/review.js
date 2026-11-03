exports.activeIds = (users) => {
  const ids = [];
  for (const user of users) {
    if (user.active) ids.push(user.id);
  }
  return ids;
};
