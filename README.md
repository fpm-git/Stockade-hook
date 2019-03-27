# Stockade-hook

This hook enforces usage of the [Stockade](https://github.com/fpm-git/stockade) module for all Sails actions, providing automagic action patching meant to validate requests against some defined criteria. Where validation criteria are not specified for any given route, that route will always yield in a **403 Forbidden** response being sent to the user, as a strict safety measure.

Reading the [Stockade readme](https://github.com/fpm-git/Stockade/blob/master/README.md) can be quite helpful and is suggested.

# Features

## Stockade permission validation

The primary goal of this hook is to enforce and automatically apply Stockade permission validations in a convenient way. Stockade usage is described quote thoroughly in the [Stockade readme](https://github.com/fpm-git/Stockade/blob/master/README.md). A [dedicated section](https://github.com/fpm-git/Stockade/blob/master/README.md#coupled-with-stockade-hook) exists regarding playing together with this hook.


## Action parameter validation

This hook now provides not only convenient Stockade functionality, but also exposes a means of defining automatically executed validations against both Joi and Waterline schema.

Action validation definitions are defined in the same general location as your Stockade permission validations: the Sails `_config` object on each controller. Unlike Stockade permissions though, the presence of parameter validations is not strictly enforced and actions will work fine without them (this is a completely opt-in feature).

### Simple parameter validation

Parameter validations may be defined as simple objects which will be converted to Joi object schema:

```js
/**
 * @file UserController.js
 * Provides actions related to updating and retrieving user data.
 */

const { Joi, Permissions } = require('stockade-hook');

module.exports = {

    _config: {
        permissions: {
            getInfo: Permissions.for('user').allOf('isLoggedIn'),
        },
        validations: {
            getInfo: {
                userId: Joi.string().hex().length(24).required(),
            },
        },
    },

    async getInfo(req, res) {
        // ...
    },

};
```

The configuration above will ensure that the `getInfo` action has a parameter `userId` which satisfies all of:

  - is a string
  - is a hexadecimal string
  - has a length of exactly 24 characters

If any condition above could not be satisfied, the `getInfo` action will not be run and an error will be sent out instead (via `res.badRequest(...)`). If the Floatplane Errors hook is also installed, generated errors will be enriched with additional info and functionality (such as localisation, etc.).

Whenever Joi validations are executed without error, the sanitised result of this validation will be assigned to the `req.validatedParams` property. This allows for accessing any Joi-assigned defaults and avoiding any parameters which were stripped by Joi.

If additional control over the parameters validation schema is required, an already-constructed Joi schema may be passed just as well:

```js
        validations: {
            getInfo: Joi.object().keys({
                userId: Joi.string().hex().length(24).required(),
            }).unknown(false),
        },
```

Simple parameter validation should always be preferred when possible. Some cases where it may not be possible include scenarios where either:

  1. your parameter schema includes a field named example `joi` or `waterline`; or
  2. more control is required over the source schema itself.

The limitation described by case #1 is brought about by the need for explicit/advanced validators. These are validators defined like so:

```js
        validations: {
            getInfo: {
                joi: {
                    userId: Joi.string().hex().length(24).required(),
                },
                waterline: {
                    // ...
                },
            },
        },
```

If stockade-hook ever sees a `joi` or `waterline` top-level validator property, the schema is promoted to an advanced property which may contain not only Joi validations, but Waterline validations as well.

As is demonstrated above, advanced validators accept the same form of Joi schema as simple validators–the only difference is that the schema is now associated with the `joi` property.


### Validating against Waterline model attributes

In addition to validating request parameters against Joi schema, it is also possible to perform validations against Waterline model attributes. This can be quite convenient when it's required to accept data which might be used to create or patch some model instance.

In order to validate against Waterline, we must create an advanced validator to inform stockade-hook that we'd like something beyond just simple Joi validation.

Performing validation against some Waterline model might look something like so:

```js
/**
 * @file UserController.js
 * Provides actions related to updating and retrieving user data.
 */

const { Joi, Permissions } = require('stockade-hook');

module.exports = {

    _config: {
        permissions: {
            getInfo: Permissions.for('user').allOf('isLoggedIn'),
        },
        validations: {
            getInfo: {
                joi: {
                    username: Joi.string().required(),
                },
                waterline: {
                    username: 'User.username',
                },
            },
        },
    },

    async getInfo(req, res) {
        // ...
    },

};
```

The schema defined above will ensure that the `username` parameter fully satisfies all Sails model validations defined for the `User.username` attribute. If an invalid value is given, the action will not execute.

Waterline validations may be augmented with usage of either `and` or `or` functionality.

For example, to allow through a value which is either a `User.username` or `User.email`:

```js
                waterline: {
                    usernameOrEmail: { or: ['User.username', 'User.email'] },
                },
```

Please note that Joi validations will always be executed prior to Waterline validations, and that these Waterline validations might be avoided altogether if the Joi validation phase fails. Additionally, Waterline validations may of course be defined without any `joi` block.


### Advanced Joi validation control

By default, stockade-hook does not supply any extra options to the Joi validation function. As a result of this, unknown fields are forbidden, error-checking aborts early after the first error is found, and so on consistent with the Joi defaults.

If refined control over the Joi validation is required, options may be provided by assigning a tuple of form `[schema, options]` for any Joi schema. In this form, `schema` represents a Joi schema as described prior, while `options` represents an object to be passed to the [`Joi.validate`](https://github.com/hapijs/joi/blob/master/API.md#validatevalue-schema-options-callback) call made upon validation.

An example where the early abort default is disabled:

```js
/**
 * @file UserController.js
 * Provides actions related to updating and retrieving user data.
 */

const { Joi, Permissions } = require('stockade-hook');

module.exports = {

    _config: {
        permissions: {
            getInfo: Permissions.for('user').allOf('isLoggedIn'),
        },
        validations: {
            getInfo: {
                joi: [{
                    // The usual Joi schema goes here at [0].
                    username: Joi.string().required(),
                    include: Joi.array().items(
                        Joi.string().only('playlists', 'subscriptions'),
                    ),
                }, {
                    // Joi.validate options go here at [1].
                    abortEarly: false,
                }],
            },
        },
    },

    async getInfo(req, res) {
        // ...
    },

};
```
