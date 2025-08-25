#!/usr/bin/env node

import { Command } from 'commander';
import { resumePatch } from './workflow.js';
import chalk from 'chalk';
import path from 'path';
import fs from 'fs/promises';

const program = new Command();

program
  .name('resume-patch')
  .description('AI-powered resume optimization tool using LangGraph')
  .version('1.0.0');

program
  .command('optimize')
  .description('Optimize resume against job description')
  .argument('<resume>', 'Path to resume file (PDF)')
  .option('-j, --job <url>', 'Job description URL')
  .option('-t, --text <text>', 'Job description text')
  .option('-o, --output <path>', 'Output path for optimized resume')
  .option('--allow-disk', 'Allow writing temporary files to disk for validation/export', false)
  .action(async (resume, options) => {
    try {
      console.log(chalk.blue('🚀 Starting resume optimization...'));
      
      // Validate resume file exists
      const resumePath = path.resolve(resume);
      try {
        await fs.access(resumePath);
      } catch (error) {
        console.error(chalk.red('❌ Resume file not found:'), resume);
        process.exit(1);
      }
      
      // Validate that at least one job description source is provided
      if (!options.job && !options.text) {
        console.error(chalk.red('❌ Please provide either --job URL or --text for job description'));
        process.exit(1);
      }
      
      // Validate URL format if provided
      if (options.job && !isValidUrl(options.job)) {
        console.error(chalk.red('❌ Invalid job description URL format'));
        process.exit(1);
      }
      
      // Security notice
      console.log(chalk.yellow('⚠️  Security notice: Avoid uploading or sharing sensitive PDFs. By default we process in-memory and avoid writing temp files. Use --allow-disk to opt-in.'));

      const result = await resumePatch(resumePath, options);
      
      if (result.output_files) {
        console.log(chalk.green('✅ Optimization completed successfully!'));
        console.log(chalk.green(`📄 JSON Resume: ${result.output_files.json}`));
        console.log(chalk.green(`📄 PDF Resume: ${result.output_files.pdf}`));
      } else {
        console.log(chalk.yellow('⚠️  Optimization completed with warnings'));
      }
      
    } catch (error) {
      console.error(chalk.red('❌ Optimization failed:'), error.message);
      process.exit(1);
    }
  });

// Helper function to validate URL format
function isValidUrl(string) {
  try {
    new URL(string);
    return true;
  } catch (_) {
    return false;
  }
}

program.parse();
