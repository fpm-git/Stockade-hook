
const fs = require('fs');
const path = require('path');

module.exports = function loadProviders(pathName) {
  // Fetch a list of all files inside the requested directory.
  const entries = fs.readdirSync(pathName)
    // Filter out the file list to only `.js` files, so we don't try and load some .DS_STORE, etc.
    .filter(fileName => path.extname(fileName).toLowerCase() === '.js');

  entries.forEach(entry => {
    const def = require(path.join(pathName, entry));
    if (!(def instanceof Object) || (typeof def.register !== 'function')) {
      throw new Error(`Expected permission definition file "${entry}" to be an object with function #register(...), but instead found: ${JSON.stringify(def)}.`);
    }
    return def.register();
  });
};

