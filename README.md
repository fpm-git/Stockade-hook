# sails-hook-floatperms

This hook enforces usage of the [floatperms](https://github.com/fpm-git/floatperms) module for all Sails actions, providing automagic action patching meant to validate requests against some defined criteria. Where validation criteria are not specified for any given route, that route will always yield in a **403 Forbidden** response being sent to the user, as a strict safety measure.

Reading the [floatperms readme](https://github.com/fpm-git/floatperms/blob/master/README.md) can be quite helpful and is suggested.
