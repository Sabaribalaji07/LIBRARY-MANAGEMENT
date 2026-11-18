/**
 * Global Error Boundary & Exception Handling Middleware
 * 
 * Provides a standardized error boundary layer across the entire Express application.
 * Normalizes all error types (validation errors, database constraint violations,
 * unhandled exceptions) into a predictable, machine-readable JSON structure.
 * 
 * Standard Error Envelope Format:
 * {
 *   "success": false,
 *   "error": {
 *     "code": "ERROR_CODE_STRING",
 *     "message": "Human readable error description",
 *     "statusCode": 400 | 401 | 404 | 409 | 422 | 500,
 *     "timestamp": "ISO-8601 UTC timestamp",
 *     "details": null | object
 *   }
 * }
 */

/**
 * Custom Application Error class for domain-specific boundary errors.
 */
class AppError extends Error {
  /**
   * @param {string} message - Human readable error message
   * @param {number} statusCode - HTTP status code
   * @param {string} code - Machine-readable error code
   * @param {any} [details=null] - Optional contextual metadata
   */
  constructor(message, statusCode = 500, code = 'INTERNAL_SERVER_ERROR', details = null) {
    super(message);
    this.name = 'AppError';
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
    Error.captureStackTrace(this, this.constructor);
  }
}

/**
 * 404 Not Found Catch-All Middleware
 * Catches any unmatched route requests and returns a structured 404 JSON response.
 */
function notFoundHandler(req, res, next) {
  const error = new AppError(
    `API endpoint not found: ${req.method} ${req.originalUrl}`,
    404,
    'ENDPOINT_NOT_FOUND'
  );
  next(error);
}

/**
 * Global Express Error Boundary Middleware
 * Central error catcher for all synchronous and asynchronous route errors.
 */
function globalErrorHandler(err, req, res, next) {
  // Default values
  let statusCode = err.statusCode || 500;
  let code = err.code || 'INTERNAL_SERVER_ERROR';
  let message = err.message || 'An unexpected internal server error occurred.';
  let details = err.details || null;

  // Handle Express body-parser JSON syntax errors (Malformed JSON payload)
  if (err instanceof SyntaxError && err.status === 400 && 'body' in err) {
    statusCode = 400;
    code = 'MALFORMED_JSON_PAYLOAD';
    message = 'Request body contains invalid or malformed JSON syntax.';
  }

  // Handle SQLite constraint violations from better-sqlite3
  if (err.message && err.message.includes('FOREIGN KEY constraint failed')) {
    statusCode = 422;
    code = 'FOREIGN_KEY_VIOLATION';
    message = 'Referenced record (user or book) does not exist in the database.';
  } else if (err.message && err.message.includes('UNIQUE constraint failed')) {
    statusCode = 409;
    code = 'DUPLICATE_RESOURCE';
    message = 'A resource with these unique identifiers already exists.';
    details = err.message;
  } else if (err.message && err.message.includes('CHECK constraint failed')) {
    statusCode = 400;
    code = 'CHECK_CONSTRAINT_VIOLATION';
    message = 'Supplied data violates database integrity check constraints.';
  }

  // Construct standardized error response envelope
  const errorEnvelope = {
    success: false,
    error: {
      code: code,
      message: message,
      statusCode: statusCode,
      timestamp: new Date().toISOString(),
      details: details
    }
  };

  // Only log 500 errors to avoid terminal clutter on expected client-side errors
  if (statusCode >= 500) {
    console.error(`[Error Boundary 500] ${req.method} ${req.url}:`, err);
  }

  res.status(statusCode).json(errorEnvelope);
}

module.exports = {
  AppError,
  notFoundHandler,
  globalErrorHandler
};
