export class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ValidationError";
  }
}

export class TransientExternalError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TransientExternalError";
  }
}

export class PermanentExternalError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PermanentExternalError";
  }
}

export class ConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConflictError";
  }
}
