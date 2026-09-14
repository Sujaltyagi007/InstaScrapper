/** Domain-level errors, independent of any transport (HTTP status is mapped
 * in api-helpers.jsonError). Keeps services free of HTTP-specific concerns. */
export class NotFoundError extends Error {
  constructor(message = "Not found.") {
    super(message);
  }
}
