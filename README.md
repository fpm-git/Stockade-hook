# Stockade-hook

This hook enforces usage of the [Stockade](https://github.com/fpm-git/stockade) module for all Sails actions, providing automagic action patching meant to validate requests against some defined criteria. Where validation criteria are not specified for any given route, that route will always yield in a **403 Forbidden** response being sent to the user, as a strict safety measure.

Reading the [Stockade readme](https://github.com/fpm-git/Stockade/blob/master/README.md) can be quite helpful and is suggested.
