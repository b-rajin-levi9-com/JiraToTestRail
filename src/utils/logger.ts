import chalk from 'chalk';

export enum LogLevel {
  INFO = 'info',
  SUCCESS = 'success',
  WARNING = 'warning',
  ERROR = 'error',
}

export class Logger {
  private verbose: boolean;

  constructor(verbose: boolean = false) {
    this.verbose = verbose;
  }

  setVerbose(verbose: boolean) {
    this.verbose = verbose;
  }

  info(message: string, ...args: any[]) {
    console.log(chalk.blue('ℹ'), message, ...args);
  }

  success(message: string, ...args: any[]) {
    console.log(chalk.green('✓'), chalk.green(message), ...args);
  }

  warning(message: string, ...args: any[]) {
    console.log(chalk.yellow('⚠'), chalk.yellow(message), ...args);
  }

  error(message: string, ...args: any[]) {
    console.error(chalk.red('✗'), chalk.red(message), ...args);
  }

  verboseLog(message: string, ...args: any[]) {
    if (this.verbose) {
      console.log(chalk.gray('→'), chalk.gray(message), ...args);
    }
  }

  log(message: string, ...args: any[]) {
    console.log(message, ...args);
  }
}

export const logger = new Logger();

