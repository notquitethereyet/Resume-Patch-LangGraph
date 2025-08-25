import fs from 'fs/promises';
import path from 'path';
import { config } from '../config.js';

export async function validateFile(filePath) {
  try {
    const stats = await fs.stat(filePath);
    
    // Check file size
    if (stats.size > config.files.maxFileSize) {
      throw new Error(`File size ${stats.size} bytes exceeds maximum allowed size ${config.files.maxFileSize} bytes`);
    }
    
    // Check file extension
    const ext = path.extname(filePath).toLowerCase();
    if (!config.files.supportedFormats.includes(ext)) {
      throw new Error(`Unsupported file format: ${ext}. Supported formats: ${config.files.supportedFormats.join(', ')}`);
    }
    
    return {
      exists: true,
      size: stats.size,
      extension: ext,
      path: filePath
    };
  } catch (error) {
    if (error.code === 'ENOENT') {
      throw new Error(`File not found: ${filePath}`);
    }
    throw error;
  }
}

export async function createTempDir() {
  try {
    await fs.mkdir(config.files.tempDir, { recursive: true });
    return config.files.tempDir;
  } catch (error) {
    throw new Error(`Failed to create temp directory: ${error.message}`);
  }
}

export async function cleanupTempFiles() {
  try {
    const tempDir = config.files.tempDir;
    const files = await fs.readdir(tempDir);
    
    for (const file of files) {
      await fs.unlink(path.join(tempDir, file));
    }
    
    await fs.rmdir(tempDir);
  } catch (error) {
    // Ignore cleanup errors
    console.warn('Warning: Failed to cleanup temp files:', error.message);
  }
}

// Lightweight HTML to text conversion for JD fetching fallback
export function htmlToText(html) {
  if (!html || typeof html !== 'string') return '';
  // Remove scripts/styles
  const withoutScripts = html.replace(/<script[\s\S]*?<\/script>/gi, '');
  const withoutStyles = withoutScripts.replace(/<style[\s\S]*?<\/style>/gi, '');
  // Strip tags
  const noTags = withoutStyles.replace(/<[^>]+>/g, ' ');
  // Decode basic entities
  const decoded = noTags
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
  return decoded.replace(/[ \t\f\v\u00A0]+/g, ' ').replace(/\s*\n\s*/g, '\n').trim();
}
