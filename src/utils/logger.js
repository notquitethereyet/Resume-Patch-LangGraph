import chalk from 'chalk';

const LOG_LEVELS = {
  ERROR: 0,
  WARN: 1,
  INFO: 2,
  DEBUG: 3
};

let currentLogLevel = LOG_LEVELS.INFO;

export function setLogLevel(level) {
  if (typeof level === 'string') {
    level = LOG_LEVELS[level.toUpperCase()] || LOG_LEVELS.INFO;
  }
  currentLogLevel = level;
}

export function log(level, message, data = null) {
  if (level <= currentLogLevel) {
    const timestamp = new Date().toISOString();
    let formattedMessage = `[${timestamp}] `;
    
    switch (level) {
      case LOG_LEVELS.ERROR:
        formattedMessage += chalk.red('ERROR: ');
        break;
      case LOG_LEVELS.WARN:
        formattedMessage += chalk.yellow('WARN: ');
        break;
      case LOG_LEVELS.INFO:
        formattedMessage += chalk.blue('INFO: ');
        break;
      case LOG_LEVELS.DEBUG:
        formattedMessage += chalk.gray('DEBUG: ');
        break;
    }
    
    formattedMessage += message;
    
    if (data) {
      formattedMessage += '\n' + JSON.stringify(data, null, 2);
    }
    
    console.log(formattedMessage);
  }
}

export const logger = {
  error: (message, data) => log(LOG_LEVELS.ERROR, message, data),
  warn: (message, data) => log(LOG_LEVELS.WARN, message, data),
  info: (message, data) => log(LOG_LEVELS.INFO, message, data),
  debug: (message, data) => log(LOG_LEVELS.DEBUG, message, data),
  setLevel: setLogLevel
};
