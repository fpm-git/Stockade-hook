
const Permissions = require('floatperms');

class SailsHookFloatperms {

    constructor(sails) {
        this.sails = sails;
        this._bindEventHandlers();
    }

    configure() {

    }

    initialize(done) {
        this.sails.log.debug('[sails-hook-floatperms] Loaded OK!');
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
                code: 'malformedAction',
                message: 'Malformed action received!',
            },
            badConfig: {
                code: 'badConfig',
                message: 'Invalid configuration has caused the request to be unhandleable.',
            },
        };

        // if we're missing the middlewareType field or it's not formatted properly, then there's something goofed up about this request, reject..
        if ((typeof action._middlewareType !== 'string') || (!action._middlewareType.startsWith('ACTION:'))) {
            this.sails.log.warn('[sails-hook-floatperms]', 'Received funky non-action request:', req);
            return res.serverError({ errors: [RESPONSES.malformedAction] });
        }

        // ensure we presently have the controller config loaded, otherwise reject..
        if (!this.sails || !this.sails.config || !this.sails.config.blueprints || !this.sails.config.blueprints._controllers) {
            this.sails.log.error('[sails-hook-floatperms]', 'Failed to locate the `_controllers` field in blueprints config! Ensure you are running Sails v1!');
            return res.serverError({ errors: [RESPONSES.badConfig] });
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
            this.sails.log.error('[sails-hook-floatperms]', `Unable to locate controller information for "${fullActionPath}". No such entry exists in the natural or marlin configs.`);
            return res.serverError({ errors: [RESPONSES.badConfig] });
        }

        const marlinConfig = (marlinController && (typeof marlinController === 'object')) ? marlinController._config : {};
        const marlinPerms = ((marlinConfig && (typeof marlinConfig === 'object')) ? marlinConfig : {}).permissions;
        const naturalPerms = ((controller && (typeof controller === 'object')) ? controller : {}).permissions;

        // ensure our `permissions` types are proper objects if they have some truthy value (i.e. they'll not be replaced by an object already)
        if (marlinPerms && (typeof marlinPerms !== 'object')) {
            this.sails.log.error('[sails-hook-floatperms]', `The marlin-configured \`permissions\` for "${fullActionPath}" are invalid. Expected a proper object but instead found: (${typeof marlinPerms}) ${marlinPerms}`);
            return res.serverError({ errors: [RESPONSES.badConfig] });
        }
        if (naturalPerms && (typeof naturalPerms !== 'object')) {
            this.sails.log.error('[sails-hook-floatperms]', `The configured \`permissions\` for "${fullActionPath}" are invalid. Expected a proper object but instead found: (${typeof naturalPerms}) ${naturalPerms}`);
            return res.serverError({ errors: [RESPONSES.badConfig] });
        }

        // merge all permissions... (on a per-action level)
        const allPerms = Object.assign(naturalPerms || {}, marlinPerms || {});

        // grab the matcher for this action
        const matcher = allPerms[actionCaseName];

        if (!matcher) {
            this.sails.log.warn('[sails-hook-floatperms]', `Found no entry for "${actionCaseName}" in the \`permissions\` block of the "${controllerIdent}" controller. The request has been forbidden by default.`);
            return res.forbidden({ errors: [RESPONSES.badConfig] });
        }

        // collects the fail explanations from the given validation results array, returning a format suitable for res.forbidden
        // (in the future, may want to filter this based on conformance to { code: string, message: string })
        const collectFails = (failedValidations) => {
            if (!Array.isArray(failedValidations)) {
                return [];
            }
            return failedValidations.map(v => {
                return v.explanation;
            }).filter(v => v);
        };

        try {
            Permissions.validate(req, matcher).then(validationRes => {
                if (!validationRes.hasPassed) {
                    // if we've some errors, log them...
                    if (validationRes.thrownErrors.length > 0) {
                        this.sails.log.error('[sails-hook-floatperms]', 'Errors were thrown during request validation:');
                        validationRes.thrownErrors.forEach((e, i) => {
                            this.sails.log.error('[sails-hook-floatperms]', `#${i + 1})`, e);
                        });
                    }
                    return res.forbidden({ errors: collectFails(validationRes.failedValidations) });
                }
                try {
                    return (action.constructor.name !== 'AsyncFunction') ? action(req, res) : action(req, res).catch(e => {
                        if (!res.headersSent) {
                            res.serverError();
                        }
                        return this.sails.log.error('[sails-hook-floatperms]', `Error executing action "${fullActionPath}":`, e);
                    });
                } catch (e) {
                    if (!res.headersSent) {
                        res.serverError();
                    }
                    return this.sails.log.error('[sails-hook-floatperms]', `Error executing action "${fullActionPath}":`, e);
                }
            }).catch(err => {
                throw err;
            });
        } catch (err) {
            this.sails.log.error('[sails-hook-floatperms]', 'Error occurred during request validation:', err);
            return res.serverError();
        }
    }

}

function declassify(inst) {
    if (inst && inst.constructor) {
        Object.getOwnPropertyNames(inst.constructor.prototype || 0).filter(i => i !== 'constructor').forEach(i => inst[i] = inst[i]);
    }
    return inst;
}

module.exports = (sails) => declassify(new SailsHookFloatperms(sails));
