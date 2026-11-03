exports.activeIds = (users) => users.filter((user) => user.active).map((user) => user.id);
