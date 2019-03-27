
/**
 * @todo Provide a simple error service wrapper alongside this, so consumers can transparently
 * use what may or may not be the Floatplane Errors hook (when the errors hook isn't installed
 * we can simply emulate basic functionality for it here).
 */

/**
 * Used to hold any error service object found to match the appropriate interface expected
 * from the Floatplane Errors hook. A small optimisation used to avoid repeated checks for
 * validity.
 */
let cacheErrorService = null;

/**
 * Attempts to fetch something which at least looks like the Floatplane error hook service.
 * If an appropriate service is found, it will be returned, else `null`.
 */
function getErrorService() {
  // If we're sure there's a proper error service already, simply return that.
  if (cacheErrorService) {
    return cacheErrorService;
  }

  // Try and fetch our global error service.
  const ErrorService = global.ErrorService;
  // Ensure the fetched error service matches the expected service interface, returning `null` if not.
  if (
    !(ErrorService instanceof Object)
    || !(ErrorService.isError instanceof Function) || !(ErrorService.isErrorGroup instanceof Function)
    || !(ErrorService.createError instanceof Function) || !(ErrorService.groupErrors instanceof Function)
  ) {
    return null;
  }

  // We've a good error service present! Set the cached service so we can avoid some checks later on (micro-opt).
  cacheErrorService = ErrorService;
  return ErrorService;
}

module.exports = {
  tryGetErrorService: getErrorService,
};
