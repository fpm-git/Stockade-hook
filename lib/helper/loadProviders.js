
const fs = require('fs');
const path = require('path');

module.exports = function loadProviders (pathName) {
  const entries = fs.readdirSync(pathName);

  entries.forEach(entry => {
    const def = require(path.join(pathName, entry));
    if (!(def instanceof Object) || (typeof def.register !== 'function')) {
      throw new Error(`Expected permission definition file "${entry}" to be an object with function #register(...), but instead found: ${JSON.stringify(def)}.`);
    }
    return def.register();
  });
};

