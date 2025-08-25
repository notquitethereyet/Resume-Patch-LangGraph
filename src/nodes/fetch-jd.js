import { logger } from '../utils/logger.js';
import { ProcessingError } from '../utils/error-handler.js';
import { htmlToText } from '../utils/file-utils.js';

export async function fetchJDNode(state) {
  logger.info('📋 Fetching job description...');

  try {
    // If text already provided, normalize and return
    if (state.jd_text && typeof state.jd_text === 'string' && state.jd_text.trim().length > 0) {
      const content = state.jd_text.trim();
      const jobData = {
        source: 'text',
        content,
        fetched: true,
        length: content.length,
        sections: extractJDSections(content)
      };
      logger.info('Job description provided as text input');
      logger.info('JD snippet (text)', { snippet: content.substring(0, 600) });
      return { ...state, jobDescription: jobData, jd_text: content };
    }

    // Otherwise try URL
    if (state.jd_url && isValidUrl(state.jd_url)) {
      logger.info('Job description is a URL, fetching content...', { url: state.jd_url });
      try {
        const res = await fetch(state.jd_url, { redirect: 'follow' });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const html = await res.text();
        const text = htmlToText(html);
        const trimmed = text.trim();
        const jobData = {
          source: 'url',
          url: state.jd_url,
          content: trimmed,
          fetched: true,
          length: trimmed.length,
          sections: extractJDSections(trimmed)
        };
        logger.info('Job description fetched from URL', { length: trimmed.length });
        logger.info('JD snippet (url)', { snippet: trimmed.substring(0, 600) });
        return { ...state, jobDescription: jobData, jd_text: trimmed };
      } catch (e) {
        logger.warn('URL fetch failed; falling back to prompt text', { error: e.message });
        // Leave jd_text empty to be handled by later nodes or CLI prompt
        const jobData = {
          source: 'url',
          url: state.jd_url,
          content: null,
          fetched: false,
          error: e.message
        };
        return { ...state, jobDescription: jobData };
      }
    }

    throw new ProcessingError('No job description provided');
  } catch (error) {
    logger.error('Failed to fetch job description', { error: error.message });
    return { ...state, error: error.message };
  }
}

function isValidUrl(string) {
  try {
    const url = new URL(string);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch (_) {
    return false;
  }
}

function extractJDSections(text) {
  const sections = {};
  
  // Split text into lines
  const lines = text.split('\n').map(line => line.trim()).filter(line => line.length > 0);
  
  let currentSection = 'overview';
  let currentContent = [];
  
  for (const line of lines) {
    const lowerLine = line.toLowerCase();
    
    // Detect common job description sections
    if (lowerLine.includes('requirements') || lowerLine.includes('qualifications')) {
      if (currentContent.length > 0) {
        sections[currentSection] = currentContent.join('\n').trim();
      }
      currentSection = 'requirements';
      currentContent = [];
    } else if (lowerLine.includes('responsibilities') || lowerLine.includes('duties')) {
      if (currentContent.length > 0) {
        sections[currentSection] = currentContent.join('\n').trim();
      }
      currentSection = 'responsibilities';
      currentContent = [];
    } else if (lowerLine.includes('skills') || lowerLine.includes('technologies')) {
      if (currentContent.length > 0) {
        sections[currentSection] = currentContent.join('\n').trim();
      }
      currentSection = 'skills';
      currentContent = [];
    } else if (lowerLine.includes('experience') || lowerLine.includes('years')) {
      if (currentContent.length > 0) {
        sections[currentSection] = currentContent.join('\n').trim();
      }
      currentSection = 'experience';
      currentContent = [];
    } else {
      currentContent.push(line);
    }
  }
  
  // Add the last section
  if (currentContent.length > 0) {
    sections[currentSection] = currentContent.join('\n').trim();
  }
  
  return sections;
}
