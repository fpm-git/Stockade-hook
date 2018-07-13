const Permissions = require('stockade');
const fs = require('fs');
const path = require('path');

class SailsHookStockade {
  constructor(sails) {
    this.sails = sails;
    this._bindEventHandlers();
  }

  defaults() {
    return {
      stockade: {
        /**
 * How returned errors should be wrapped, if at all. Possible options:
 *
 * - false (boolean): Prevents errors from being wrapped at all. They will be
 * returned just as they are from the validator.
 * - 'all' (string): Wraps all errors returned from the validator.
 * - 'first' (string): Wraps just the first error returned from the validator.
 * If the floatplane-hook-errors is installed, then any FloatplaneError objects
 * will take precedence.
 * - 'notLoggedIn' (string): Special mode which will act differently depending
 * on the errors returned from the validator. If a FloatplaneError is returned
 * of type 'notLoggedInError', then it will be the only error wrapped. If there
 * is no such error returned, then this mode behaves like 'all'.
 */
        wrapErrors: 'all',
      }
    };
  }

  initialize(done) {
    this.sails.log.debug('[sails-hook-stockade] Loaded OK!');
    return done();
  }

  routes() {
  }

  _bindEventHandlers() {
    this.sails.on('router:route', (event) => {
      const req = event.req;

      // leave if we've no action
      if (!req || !req.options || !req.options.action) {
        return;
      }

      // try and patch this action
      // (patching the action directly is preferred, since we can only trigger a 500 error from here, while we want a 403)
      // (by patching, we intercept the request logic, still allowing any general policies to run beforehand, but catching scenarios where no permissions are manually set)
      this._patchAction(req.options.action);
    });
  }

  _patchAction(actionName) {
    // preserve the original action
    const action = this.sails._actions[actionName];

    // leave if the named action could not be found: nothing to patch
    if (typeof action !== 'function') {
      return;
    }

    // leave if the action has already been patched
    if (action._aclHookPatch) {
      return;
    }

    // generate a wrapped action, minding the async-ness of the original
    const wrappedAction = (action.constructor.name === 'AsyncFunction')
      ? async (req, res) => this._executeActionWrapped(req, res, action)
      : (req, res) => this._executeActionWrapped(req, res, action);

    // copy all properties from the original action (something like '_middlewareType')
    for (const key in action) {
      wrappedAction[key] = action[key];
    }
    // clone the original name
    Object.defineProperty(wrappedAction, 'name', { value: action.name + '_patch', writable: false });
    // add an indicator, so we'll not rewrap this action
    Object.defineProperty(wrappedAction, '_aclHookPatch', { value: true, writable: false });

    // update the actual action record
    this.sails._actions[actionName] = wrappedAction;
  }

  _executeActionWrapped(req, res, action) {
    const RESPONSES = {
      malformedAction: {
        name: 'malformedAction',
        message: 'Malformed action received!',
      },
      badConfig: {
        name: 'badConfig',
        message: 'Invalid configuration has caused the request to be unhandleable.',
      },
    };

    // If we have the floatplane-hook-error service defined global, we'll convert all the RESPONSES above into FloatplaneErrors.
    // [Normally we wouldn't do this, as having them be plain objects is totally great, they'd be automatically logged and all.]
    // [The exception is being made here simply for clarity purposes, since none of these errors expose anything truly private.]
    // [If this changes and private data is for some reason included in output errors, make sure to remove this conversion.]
    const hasErrorService = ((global.ErrorService instanceof Object) && (global.ErrorService.createError instanceof Function));
    if (hasErrorService) {
      for (const k in RESPONSES) {
        RESPONSES[k] = global.ErrorService.createError(RESPONSES[k].name, RESPONSES[k].message);
      }
    }

    // if we're missing the middlewareType field or it's not formatted properly, then there's something goofed up about this request, reject..
    if ((typeof action._middlewareType !== 'string') || (!action._middlewareType.startsWith('ACTION:'))) {
      this.sails.log.warn('[sails-hook-stockade]', 'Received funky non-action request:', req);
      return res.serverError(RESPONSES.malformedAction);
    }

    // ensure we presently have the controller config loaded, otherwise reject..
    if (!this.sails || !this.sails.config || !this.sails.config.blueprints || !this.sails.config.blueprints._controllers) {
      this.sails.log.error('[sails-hook-stockade]', 'Failed to locate the `_controllers` field in blueprints config! Ensure you are running Sails v1!');
      return res.serverError(RESPONSES.badConfig);
    }

    // grab the complete action path
    const fullActionPath = action._middlewareType.substr('ACTION:'.length).trim();
    // break that path into separate components
    const components = fullActionPath.split('/');
    // extract the action controller path (all but the last component, joined by '/')
    const controllerIdent = components.filter((v, i, a) => i !== a.length - 1).join('/');
    // extract the action name itself within the owning controller (just the last component)
    const actionName = components.pop();
    // get the cased name..
    const actionCaseName = action.name.substr(0, actionName.length);    // (-'_patch')

    // try and grab our natural and marlin configs (one of these may be undefined, but at least one MUST be defined)
    const controller = this.sails.config.blueprints._controllers[controllerIdent];
    const marlinController = (this.sails.controllers && this.sails.controllers[controllerIdent]) ? this.sails.controllers[controllerIdent] : undefined;


    // handle a particular weird case... (this really shouldn't happen unless marlin or sails change/break in some way, but it's better to be safe than sorry...)
    if ((!controller && !marlinController) || (typeof controller !== 'object' && typeof marlinController !== 'object')) {
      this.sails.log.error('[sails-hook-stockade]', `Unable to locate controller information for "${fullActionPath}". No such entry exists in the natural or marlin configs. Make sure you've defined a \`_config\` in the target controller!`);
      return res.serverError(RESPONSES.badConfig);
    }

    const marlinConfig = (marlinController && (typeof marlinController === 'object')) ? marlinController._config : {};
    const marlinPerms = ((marlinConfig && (typeof marlinConfig === 'object')) ? marlinConfig : {}).permissions;
    const naturalPerms = ((controller && (typeof controller === 'object')) ? controller : {}).permissions;

    // ensure our `permissions` types are proper objects if they have some truthy value (i.e. they'll not be replaced by an object already)
    if (marlinPerms && (typeof marlinPerms !== 'object')) {
      this.sails.log.error('[sails-hook-stockade]', `The marlin-configured \`permissions\` for "${fullActionPath}" are invalid. Expected a proper object but instead found: (${typeof marlinPerms}) ${marlinPerms}`);
      return res.serverError(RESPONSES.badConfig);
    }
    if (naturalPerms && (typeof naturalPerms !== 'object')) {
      this.sails.log.error('[sails-hook-stockade]', `The configured \`permissions\` for "${fullActionPath}" are invalid. Expected a proper object but instead found: (${typeof naturalPerms}) ${naturalPerms}`);
      return res.serverError(RESPONSES.badConfig);
    }

    // merge all permissions... (on a per-action level)
    const allPerms = Object.assign(naturalPerms || {}, marlinPerms || {});

    // grab the matcher for this action
    const matcher = allPerms[actionCaseName];

    if (!matcher) {
      this.sails.log.warn('[sails-hook-stockade]', `Found no entry for "${actionCaseName}" in the \`permissions\` block of the "${controllerIdent}" controller. The request has been forbidden by default.`);
      return res.forbidden(RESPONSES.badConfig);
    }

    try {
      Permissions.validate(req, matcher).then(validationRes => {
        if (!validationRes.hasPassed) {
          // if we've some errors, log them...
          if (validationRes.thrownErrors.length > 0) {
            this.sails.log.error('[sails-hook-stockade]', 'Errors were thrown during request validation:');
            validationRes.thrownErrors.forEach((e, i) => {
              this.sails.log.error('[sails-hook-stockade]', `#${i + 1})`, e);
            });
          }
          return res.forbidden(this._collectFails(validationRes.failedValidations));
        }
        try {
          return (action.constructor.name !== 'AsyncFunction') ? action(req, res) : action(req, res).catch(e => {
            if (!res.headersSent) {
              res.serverError(e);
            }
            // If we've floatplane-hook-error installed, don't bother logging here, as it should handle logging (no double-logging please!).
            if (global.ErrorService) {
              return;
            }
            return this.sails.log.error('[sails-hook-stockade]', `Error executing action "${fullActionPath}":`, e);
          });
        } catch (e) {
          if (!res.headersSent) {
            res.serverError(e);
          }
          return this.sails.log.error('[sails-hook-stockade]', `Error executing action "${fullActionPath}":`, e);
        }
      }).catch(err => {
        throw err;
      });
    } catch (err) {
      this.sails.log.error('[sails-hook-stockade]', 'Error occurred during request validation:', err);
      return res.serverError(err);
    }
  }

  /**
 * A helper function used in processing the results of any failed validations, returning
 * a value acceptable for passing to res.forbidden.
 *
 * If the floatplane-hook-error is loaded, then all errors which aren't already FloatplaneError
 * objects will be wrapped up as such, and grouped if there are more than one.
 *
 * @param {Object[]} failedValidations - A list of failed validations as received from
 * Stockade.
 */
  _collectFails(failedValidations) {
    if (!Array.isArray(failedValidations)) {
      return global.ErrorService ? [] : { errors: [] };
    }

    // All the different types of error wrappers supported, used as per the `wrapErrors` option.
    const errorWrappers = {
      all(errors) {
        // If we've no ErrorService with an isError function, simply return the explanations as they are.
        if (!(global.ErrorService instanceof Object) || !(global.ErrorService.isError instanceof Function)) {
          return errors;
        }
        // Ensure all errors are wrapped as FloatplaneError objects and return.
        return errors.map(e => {
          if (global.ErrorService.isError(e)) {
            return e;
          }
          return global.ErrorService.createError('unknownError', undefined, undefined, e);
        });
      },
      first(errors) {
        // If we've an ErrorService with an isError function, try finding a FloatplaneError to take precedence as first.
        if ((global.ErrorService instanceof Object) && (global.ErrorService.isError instanceof Function)) {
          const fpError = errors.find(e => global.ErrorService.isError(e));
          if (fpError) {
            return [fpError];
          }
        }
        // Simply handle wrapping the first error as necessary.
        return this.all(errors.slice(0, 1));
      },
      notLoggedIn(errors) {
        // If we've no ErrorService with an isError function, then return the explanations as-is.
        if (!(global.ErrorService instanceof Object) || !(global.ErrorService.isError instanceof Function)) {
          return errors;
        }
        // Try and find our not-logged in error.
        const notLoggedInError = errors.find(e => global.ErrorService.isError(e) && (e.name === 'notLoggedInError'));
        if (notLoggedInError instanceof Object) {
          return [notLoggedInError];
        }
        // Otherwise simply use the all error wrapper.
        return this.all(errors);
      },
    };

    // Pull out our Stockade configuration object.
    const stockadeConfig = this.sails.config && this.sails.config.stockade;
    // Extract just our explanations, as that's all we're really interested in wrapping.
    const explanations = failedValidations.filter(v => v.explanation).map(v => v.explanation);
    // Find our wrap function to use, if any.
    const wrap = errorWrappers[stockadeConfig.wrapErrors];
    // Wrap all explanations, or if there is no wrapper, simply use them as-is.
    const errors = wrap ? wrap(explanations) : explanations;

    // If we've the floatplane-hook-error installed, we should group or return directly any wrapped error.
    if (wrap && (global.ErrorService instanceof Object) && (global.ErrorService.groupErrors instanceof Function)) {
      // Catch the case where there somehow are no errors (wot o.o?)
      if (errors.length === 0) {
        return [];
      }
      // If we've one error, return it directly, otherwise return an error group.
      return (errors.length === 1) ? errors[0] : global.ErrorService.groupErrors(undefined, undefined, errors);
    }
    return { errors };
  }

}

function declassify(inst) {
  if (inst && inst.constructor) {
    Object.getOwnPropertyNames(inst.constructor.prototype || 0).filter(i => i !== 'constructor').forEach(i => { inst[i] = inst[i]; });
  }
  return inst;
}

module.exports = (sails) => declassify(new SailsHookStockade(sails));
module.exports.Permissions = Permissions;
module.exports.loadProviders = (pathName) => {
  const entries = fs.readdirSync(pathName);

  entries.forEach(entry => {
    const def = require(path.join(pathName, entry));
    if (!(def instanceof Object) || (typeof def.register !== 'function')) {
      throw new Error(`Expected permission definition file "${entry}" to be an object with function #register(...), but instead found: ${JSON.stringify(def)}.`);
    }
    return def.register();
  });
};
