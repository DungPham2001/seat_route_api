const bcrypt = require('bcryptjs');
const config = require('../config');

const hash = (plain) => bcrypt.hash(plain, config.bcryptRounds);

// Compared against when the email does not exist, so unknown and wrong-password take the same time.
const DUMMY = bcrypt.hashSync('seatroute-dummy-password-1', config.bcryptRounds);

const verify = async (plain, hashed) => {
  if (typeof plain !== 'string') return false;
  return bcrypt.compare(plain, hashed || DUMMY).then((ok) => ok && !!hashed);
};

module.exports = { hash, verify };
