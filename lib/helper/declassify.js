
/**
 * @todo Make this into an npm module so we can stop defining it for each project.
 */

/**
 * Helper function which extracts the items defined in a given object's class and creates
 * plain object properties for each. As a result of this, what would have previously been
 * class methods are now directly bound to the object and as such are directly accessible
 * by `Object.keys(...)`, the `in` operator and more.
 *
 * Necessary to convince Sails into accepting the much cleaner class-based hooks.
 */
module.exports = function declassify(inst) {
  if (inst && inst.constructor) {
    // Try and fetch names from the constructor prototype, or default to a safe 0 if we've none.
    Object.getOwnPropertyNames(inst.constructor.prototype || 0)
      // Filter out any 'constructor' field, as there's no need to extract it.
      .filter(i => i !== 'constructor')
      // For every prototype field, assign it to the object itself. If the object already has
      // a property overriding the prototype-given field, then this rightfully has no effect.
      .forEach(i => {
        // eslint-disable-next-line no-self-assign
        inst[i] = inst[i];
        return inst[i];
      });
  }
  return inst;
};
