
/**
 * @todo This could use a little more cleanup, especially in the Waterline validation portion.
 * In it's current state, this module was largely just Frankenstein-ed out from the Floatplane
 * core and made to work with Stockade-hook.
 */

// Classes and fat modules.
const Joi = require('joi');
const ErrorsHelper = require('../helper/errors');
const util = require('util');

/**
 * @typedef {Object} SailsActionInfo - Object containing info regarding an invoked Sails
 * action.
 * @property {string} actionInfo.name - Name of the action being invoked.
 * @property {string} actionInfo.path - Full path of the action '/'-delimited.
 * @property {object} actionInfo.rawAction - Raw action object.
 */

/**
 * Performs validation against the given request.
 *
 * @param {SailsRequest} req - The original request to run param validation against.
 *
 * @param {SailsActionInfo} actionInfo - Information corresponding to the action triggered
 * to fulfill the given `req`.
 *
 * @param {object} schema - Schema to perform validation against. By default it is assumed
 * that this is a simple object with Joi validations contained. If a top-level `waterline`
 * property exists, then Waterline validations will be performed against the given object.
 * It is then expected that any Joi validations exist within a `joi` property.
 *
 * @returns Returns `true` if the validation succeeded. If the validation has failed, a fitting
 * error will be thrown. If the Floatplane errors hook is installed, this error will be wrapped
 * with the service when possible, else a plain `Error` thrown instead.
 *
 * @example ```
// Simple validation (Joi only):
validations: {
  login: {
    username: Joi.string().required(),
    password: Joi.string().required(),
  },
}

// Advanced validation (both Joi and Waterline):
validations: {
  login: {
    joi: {
      username: Joi.string().required(),
      password: Joi.string().required(),
    },
    waterline: {
      username: { or: ['User.username', 'User.email'] },
    },
  },
}

// For any case where a Joi schema is expected, a tuple of form [schema, options] may
// be supplied instead, containing the Joi schema along with extra options to be used
// for the validation operation:
validations: {
  login: [Joi.object().keys({
    username: Joi.string().required(),
    password: Joi.string().required(),
  }), {
    abortEarly: false,
  }],
}
```
 *
 */
async function validateParams(req, actionInfo, schema) {
  // Extract our appropriate validators.
  const { joiSchema, joiSchemaOpts, waterlineSchema } = extractSubschema(schema);

  // If we've a Joi schema, run that validation and update our request with the `validatedParams` field.
  if (joiSchema) {
    const validatedParams = testJoiValidations(req, actionInfo, joiSchema, joiSchemaOpts);
    req.validatedParams = validatedParams;
  }

  // If we've a Waterline schema, run that validation.
  if (waterlineSchema) {
    testWaterlineValidations(req, actionInfo, waterlineSchema);
  }

  // We've made it here successfully, looks like all validations have passed!
  return true;
}

/**
 * Handles extracting individual Joi and Waterline schema objects from a potentially advanced
 * schema object.
 *
 * @param {object} schema - Schema which should have subschema components extracted. For more
 * information, refer to the identically named argument belonging to `validateParams(...)`.
 */
function extractSubschema(schema) {
  // Setup our output schema object, with all schema by default `null`-ed out.
  const out = {
    joiSchema: null,
    joiSchemaOpts: null,
    waterlineSchema: null,
  };

  // If `schema` isn't an object, there's nothing to validate, so return our `null`-ed schema.
  if (!(schema instanceof Object)) {
    return out;
  }

  // Determine whether or not the validator is an advanced one with potential Waterline support.
  const isAdvancedValidator = (schema.joi instanceof Object) || (schema.waterline instanceof Object);

  // Helper function which builds Joi schema from either a plain object, tuple, or preconstructed
  // schema. Joi validation options are also extracted.
  const extractJoi = (joiSchemaObject) => {
    // If we've been given a tuple for the schema, extract options and pull the main schema out.
    if (Array.isArray(joiSchemaObject)) {
      out.joiSchemaOpts = joiSchemaObject[1];
      joiSchemaObject = (joiSchemaObject[0] instanceof Object) ? joiSchemaObject[0] : {};
    }

    // Apply our schema to the output object.
    out.joiSchema = (joiSchemaObject.isJoi === true)
      // The given object is already a constructed Joi schema, so we can use it as-is.
      ? joiSchemaObject
      // Otherwise we've a plain object given: wrap it as a Joi object.
      : Joi.object().keys(joiSchemaObject);
  };

  // Handle extracting schema depending on validator type.
  if (isAdvancedValidator) {
    // We've an advanced validator so try and extract from `joi` and `waterline` fields.
    // Extract any Joi schema as necessary.
    if (schema.joi instanceof Object) {
      extractJoi(schema.joi);
    }
    // Extract any Waterline schema.
    if (schema.waterline instanceof Object) {
      out.waterlineSchema = schema.waterline;
    }
  } else {
    // We've just a simply validator, so take it as a Joi schema.
    extractJoi(schema);
  }

  // Return out our object with each potential schema included.
  return out;
}

/**
 * Handles creating an error group for the given Joi validation error, using the Floatplane
 * error hook. If the error hook is not installed, or if the encountered error could not be
 * wrapped appropriately, then a plain `Error` is returned instead.
 *
 * @param {SailsRequest} req - The request containing the parameters that validation was
 * performed against.
 * @param {SailsActionInfo} actionInfo - Information corresponding to the action triggered
 * to fulfill the given `req`.
 * @param {ValidationError} joiError - The Joi validation error which we should generate
 * an error group for.
 *
 * @returns {FloatplaneErrorGroup|Error}
 */
function makeJoiValidationErrorGroup(req, actionInfo, joiError) {
  // Generate a prefix for all of our error i18n keys.
  const errorKeyPrefix = actionInfo.path.replace(/\//g, '.') + '.';

  if (!(joiError instanceof Object) || !Array.isArray(joiError.details)) {
    return new Error('Received an invalid Joi validation error object. Expected an object with array `details`, but instead found: ' + util.inspect(joiError));
  }

  // Try and extract the global error service, returning the original Joi error if it's not installed.
  const ErrorService = ErrorsHelper.tryGetErrorService();
  if (!ErrorService) {
    return joiError;
  }

  const errors = joiError.details.map(info => {
    const errorKey = errorKeyPrefix + info.context.key + '.' + info.type;
    // Create a new 'paramValidationError' describing this error, with the broken rule attached.
    // We'll use the original Joi error message as the default, just in case some language doesn't have the controller-specific error key defined.
    return ErrorService.createError('paramValidationError', errorKey, undefined, { rule: info.type })
      .defaultMessage(info.message);
  });

  return errors.length > 1 ? ErrorService.groupErrors(errors) : errors[0];
}

/**
 * Validates the given request's parameters against the provided Joi schema, returning a
 * plain object with sanitised parameters upon success, or throwing an error upon issue.
 *
 * @param {SailsRequest} req - A request containing parameters which should be validated
 * against the given schema.
 * @param {SailsActionInfo} actionInfo - Information regarding the action which has been
 * triggered to fulfill the given `req`.
 * @param {object} joiSchema - A Joi schema object to validate the given `req` with.
 * @param {object} [validationOpts] - Optional validation config to supply to Joi.
 *
 * @returns {object} Returns parameters sanitised from the given `req` according to the
 * `joiSchema` passed.
 *
 * @throws {FloatplaneErrorGroup|Error} Throws a fitting error if the validation failed
 * in any way. This error will be wrapped appropriately if the Floatplane error hook is
 * present, else a plain `Error` returned.
 */
function testJoiValidations(req, actionInfo, joiSchema, validationOpts) {
  const joiResult = joiSchema.validate(req.allParams(), validationOpts);
  // If we've an error encountered, wrap appropriately and throw.
  if (joiResult.error) {
    throw makeJoiValidationErrorGroup(req, actionInfo, joiResult.error);
  }
  // Otherwise all good, simply return the Joi processed result.
  return joiResult.value;
}

/**
 * Handles testing the request parameters for validity against Waterline constraints set
 * for the attributes corresponding to the given schema.
 *
 * @param {SailsRequest} req - A request containing parameters which should be validated
 * against the given schema.
 * @param {SailsActionInfo} actionInfo - Information regarding the action which has been
 * triggered to fulfill the given `req`.
 * @param {Object} wlSchema - An object defining the validations which should take place
 * against the given request's parameters.
 *
 * @returns {null} Returns `null` after executing without issue, otherwise throws.
 *
 * @throws {Error} An error if the schema contains any invalid validation definitions.
 * @throws {Error} An error if an unhandled error occurred during validation. When this
 * occurs, please ensure that floatplane-hook-waterline-errors is installed and working!
 *
 * @example
 * // Validates a username parameter against the User model's username attribute definition.
 * testWaterlineValidations(req, { username: 'User.username' });
 *
 * @example
 * // Ensures that the username parameter is either a valid `email` or `username`, as defined by the User model.
 * testWaterlineValidations(req, { username: { or: ['User.username', 'User.email'] } })
 */
function testWaterlineValidations(req, actionInfo, wlSchema) {
  // If the schema isn't an object, nothing to check, so no errors. In the future, we may
  // want to throw if this isn't properly specified.
  if (!(wlSchema instanceof Object)) {
    return null;
  }

  // Initialize our error output array.
  const errors = [];

  // Loop over all keys in our schema and handle the validation steps.
  for (const paramName in wlSchema) {
    // Get the set value for this request, skipping if not set (we only validate defined parameters, use Joi to make them required!).
    const paramReqValue = req.param(paramName);
    if (typeof paramReqValue === 'undefined') {
      continue;
    }

    // Pull the validation definition from our schema.
    const paramValidation = wlSchema[paramName];

    // Setup state used for extracting complex definitions from the validation definition object.
    let validations;
    let matchAll = false;

    // If the validation is an object, then we may have an {or: ...} or {and: ...} specifier, so handle those.
    if (paramValidation instanceof Object) {
      if (Array.isArray(paramValidation.or)) {
        validations = paramValidation.or;
      } else if (Array.isArray(paramValidation.and)) {
        matchAll = true;
        validations = paramValidation.and;
      } else {
        throw new Error(`Invalid Waterline validation specified for action "${actionInfo.path}". Expected an object with key "or" or "and" but instead found: ${util.inspect(paramValidation)}`);
      }
    } else if (typeof paramValidation === 'string') {
      validations = [paramValidation];
    } else {
      throw new Error(`Invalid Waterline validation specified for action "${actionInfo.path}". Expected either an object or string, but instead found: ${util.inspect(paramValidation)}`);
    }

    // Setup an error array to store just the errors for this specific parameter.
    const paramErrors = [];
    let failCount = 0;

    // Run all validations on this parameter.
    validations.forEach(ident => {
      // Split our identity into fragments and perform consistency checking: [model name, attribute name]
      const fragments = ident.split('.');
      if (fragments.length !== 2) {
        throw new Error(`Invalid Waterline validation specified for parameter "${paramName}" or action "${actionInfo.path}". Expected an attribute identity such as "User.username", but instead found: ${util.inspect(ident)}`);
      }
      // Try and find our model, throwing an error if it does not exist.
      const model = req._sails.models[fragments[0].toLowerCase()];
      if (!(model instanceof Object) || !(model.validate instanceof Function)) {
        throw new Error(`Invalid Waterline validation specified for parameter "${paramName}" or action "${actionInfo.path}". The named model "${fragments[0]}" does not exist.`);
      }

      // Try and run our validation, catching any error, and collecting it if it was generated
      // from the Floatplane error hook.
      try {
        model.validate(fragments[1], paramReqValue);
      } catch (e) {
        // If we're missing our error service, throw the error as-is.
        const ErrorService = ErrorsHelper.tryGetErrorService();
        if (!ErrorService) {
          throw e;
        }
        // Handle stacking on potential errors from the error hook.
        if (ErrorService.isError(e)) {
          paramErrors.push(e);
          failCount++;
        } else if (ErrorService.isErrorGroup(e)) {
          paramErrors.push(...e.errors);
          failCount++;
        } else {
          // Not from the error hook: just throw as-is.
          throw e;
        }
      }
    });

    // Calculate our minimum required and actual success counts.
    // When calculating the successCount, it's important to use failCount instead of the
    // paramErrors.length, as one validation can result in multiple errors being added.
    const minimumSuccessCount = (matchAll) ? validations.length : 1;
    const successCount = validations.length - failCount;

    // If we exceed or meet our success count, continue onto the next parameter without adding to the error list.
    if (successCount >= minimumSuccessCount) {
      continue;
    }

    // Otherwise, we've got some errors to add to our list.
    errors.push(...paramErrors.slice(0, minimumSuccessCount));
  }

  // If we've no errors: awesome, return null!
  if (errors.length === 0) {
    return null;
  }

  // Handle generating errors where there's no error service.
  const ErrorService = ErrorsHelper.tryGetErrorService();
  if (!ErrorService) {
    // If we've a single error, throw just that.
    if (errors.length === 1) {
      throw errors[0];
    }
    // If we've multiple errors, build a new error to hold all.
    const err = new Error('Multiple validation errors have occurred!');
    err.errors = errors;
    throw err;
  }

  // Either return a sole error, or make a group out of multiple errors.
  throw (errors.length === 1)
    ? errors[0]
    : ErrorService.groupErrors(undefined, undefined, errors);
}

module.exports = validateParams;
