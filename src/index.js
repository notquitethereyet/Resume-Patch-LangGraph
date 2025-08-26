#!/usr/bin/env node

import { resumePatch } from './workflow.js';
import chalk from 'chalk';
import path from 'path';
import fs from 'fs/promises';
import readline from 'readline';

// Main interactive CLI function
async function main() {
  try {
    console.log(chalk.blue('🚀 Resume Patch - AI-powered Resume Optimization'));
    console.log(chalk.gray('Interactive CLI for optimizing resumes against job descriptions\n'));
    
    // Step 1: Select resume file
    const resumeFile = await selectResumeFile();
    if (!resumeFile) {
      console.log(chalk.yellow('No PDF files found in current directory'));
      process.exit(1);
    }
    
    // Step 2: Choose job description input method
    const inputMethod = await selectInputMethod();
    
    // Step 3: Get job description based on selected method
    let jobDescription = {};
    if (inputMethod === 'url') {
      jobDescription.job = await promptForJobUrl();
    } else {
      jobDescription.text = await promptForJobDescription();
    }
    
    // Step 4: Additional options
    const options = await getAdditionalOptions();
    
    // Step 5: Security notice
    console.log(chalk.yellow('\n⚠️  Security notice: Avoid uploading or sharing sensitive PDFs. By default we process in-memory and avoid writing temp files. Use --allow-disk to opt-in.'));
    
    // Step 6: Start optimization
    console.log(chalk.blue('\n🚀 Starting resume optimization...'));
    const result = await resumePatch(resumeFile, { ...jobDescription, ...options });
    
    if (result.output_files) {
      console.log(chalk.green('\n✅ Optimization completed successfully!'));
      console.log(chalk.green(`📄 JSON Resume: ${result.output_files.json}`));
      console.log(chalk.green(`📄 PDF Resume: ${result.output_files.pdf}`));
    } else {
      console.log(chalk.yellow('\n⚠️  Optimization completed with warnings'));
    }
    
  } catch (error) {
    console.error(chalk.red('\n❌ Optimization failed:'), error.message);
    process.exit(1);
  }
}

// Helper function to select resume file
async function selectResumeFile() {
  try {
    const files = await fs.readdir('.');
    const pdfFiles = files.filter(file => file.toLowerCase().endsWith('.pdf'));
    
    if (pdfFiles.length === 0) {
      return null;
    }
    
    if (pdfFiles.length === 1) {
      console.log(chalk.green(`📄 Found resume: ${pdfFiles[0]}`));
      return pdfFiles[0];
    }
    
    console.log(chalk.blue('\nAvailable PDF files:'));
    pdfFiles.forEach((file, index) => {
      console.log(`${index + 1}. ${file}`);
    });
    
    const selectedIndex = await promptForNumber(1, pdfFiles.length, 'Select a resume file (enter number):');
    return pdfFiles[selectedIndex - 1];
  } catch (error) {
    console.error('Error reading directory:', error);
    return null;
  }
}

// Helper function to select input method
async function selectInputMethod() {
  console.log(chalk.blue('\nHow would you like to provide the job description?'));
  console.log('1. 🌐 Job posting URL');
  console.log('2. 📝 Paste job description text');
  
  const choice = await promptForNumber(1, 2, 'Enter your choice (1-2):');
  return choice === 1 ? 'url' : 'text';
}

// Helper function to prompt for job URL
async function promptForJobUrl() {
  const url = await promptForInput('Enter the job posting URL:');
  
  try {
    new URL(url);
    return url;
  } catch {
    console.log(chalk.red('Invalid URL format. Please try again.'));
    return await promptForJobUrl();
  }
}

// Helper function to prompt for job description text
async function promptForJobDescription() {
  console.log(chalk.blue('\n📝 Job Description Input'));
  console.log(chalk.gray('Please paste or type your job description below. Press Enter twice when finished:\n'));
  
  return new Promise((resolve) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });
    
    let lines = [];
    
    rl.on('line', (input) => {
      if (input.trim() === '' && lines.length > 0 && lines[lines.length - 1].trim() === '') {
        // Two consecutive empty lines - end input
        rl.close();
        const jobDescription = lines.slice(0, -1).join('\n').trim();
        resolve(jobDescription);
      } else {
        lines.push(input);
      }
    });
    
    rl.on('close', () => {
      if (lines.length === 0) {
        resolve('');
      }
    });
  });
}

// Helper function to get additional options
async function getAdditionalOptions() {
  console.log(chalk.blue('\nAdditional Options:'));
  
  const autoApply = await promptForYesNo('Automatically apply all patches without review?', false);
  const allowDisk = await promptForYesNo('Allow writing temporary files to disk?', false);
  const outputPath = await promptForInput('Output path for optimized resume:', 'optimized-resume');
  
  return {
    autoApply,
    allowDisk,
    output: outputPath
  };
}

// Helper function to prompt for a number
async function promptForNumber(min, max, message) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });
    
    const askForNumber = () => {
      rl.question(message + ' ', (input) => {
        const num = parseInt(input.trim());
        if (num >= min && num <= max) {
          rl.close();
          resolve(num);
        } else {
          console.log(chalk.red(`Please enter a number between ${min} and ${max}`));
          askForNumber();
        }
      });
    };
    
    askForNumber();
  });
}

// Helper function to prompt for input
async function promptForInput(message, defaultValue = '') {
  return new Promise((resolve) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });
    
    const prompt = defaultValue ? `${message} [${defaultValue}]: ` : `${message} `;
    rl.question(prompt, (input) => {
      rl.close();
      resolve(input.trim() || defaultValue);
    });
  });
}

// Helper function to prompt for yes/no
async function promptForYesNo(message, defaultValue = false) {
  const defaultText = defaultValue ? 'Y/n' : 'y/N';
  const input = await promptForInput(`${message} [${defaultText}]`, defaultValue ? 'y' : 'n');
  return input.toLowerCase().startsWith('y');
}

// Run the CLI
main().catch(console.error);
