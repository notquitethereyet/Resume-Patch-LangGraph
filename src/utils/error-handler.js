export class ResumePatchError extends Error {
  constructor(message, code, details = {}) {
    super(message);
    this.name = 'ResumePatchError';
    this.code = code;
    this.details = details;
    this.timestamp = new Date().toISOString();
  }
}

export class ValidationError extends ResumePatchError {
  constructor(message, details = {}) {
    super(message, 'VALIDATION_ERROR', details);
    this.name = 'ValidationError';
  }
}

export class ProcessingError extends ResumePatchError {
  constructor(message, details = {}) {
    super(message, 'PROCESSING_ERROR', details);
    this.name = 'ProcessingError';
  }
}

export class SecurityError extends ResumePatchError {
  constructor(message, details = {}) {
    super(message, 'SECURITY_ERROR', details);
    this.name = 'SecurityError';
  }
}

export function handleError(error, context = '') {
  if (error instanceof ResumePatchError) {
    console.error(`[${error.code}] ${context}: ${error.message}`);
    if (error.details && Object.keys(error.details).length > 0) {
      console.error('Details:', error.details);
    }
  } else {
    console.error(`[UNKNOWN_ERROR] ${context}: ${error.message}`);
    console.error('Stack:', error.stack);
  }
  
  return {
    error: true,
    code: error.code || 'UNKNOWN_ERROR',
    message: error.message,
    timestamp: error.timestamp || new Date().toISOString()
  };
}
