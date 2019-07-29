
// Classes and fat modules.
const Joi = require('joi');
const Permissions = require('stockade');
const SailsHookStockade = require('./lib/hook');

// Helper functions.
const loadProviders = require('./lib/helper/loadProviders');
const declassify = require('./lib/helper/declassify');

// Exports.
// Our main export is the hook itself so Sails will load things properly (run through the
// `declassify` helper to further appease Sails).
// Additional fields are attached to expose helper functions or classes.
module.exports = (sails) => declassify(new SailsHookStockade(sails));
module.exports.Joi = Joi;
module.exports.Permissions = Permissions;
module.exports.loadProviders = loadProviders;
