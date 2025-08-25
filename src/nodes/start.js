import { logger } from '../utils/logger.js';
import { validateFile } from '../utils/file-utils.js';
import { ValidationError } from '../utils/error-handler.js';

export async function startNode(state) {
  logger.info('🚀 Starting resume optimization workflow...');
  
  try {
    // Validate resume file path
    if (!state.resume_path) {
      throw new ValidationError('Resume file path is required');
    }
    
    const fileInfo = await validateFile(state.resume_path);
    logger.info('Resume file validated', { file: fileInfo });
    
    // Validate job description input
    if (!state.jd_url && !state.jd_text) {
      logger.warn('No job description provided - will prompt user later');
    }
    
    // Initialize workflow state
    const initialState = {
      ...state,
      resume: {
        path: state.resume_path,
        info: fileInfo,
        parsed: false,
        content: null
      },
      current_step: 'start',
      start_time: Date.now(),
      processing_log: [...(state.processing_log || []), 
        `Started workflow at ${new Date().toISOString()}`],
      step_timings: {
        start: Date.now() - (state.start_time || Date.now())
      }
    };
    
    logger.info('Workflow initialized successfully', { 
      resumePath: state.resume_path,
      hasJobDescription: !!(state.jd_url || state.jd_text)
    });
    
    return initialState;
  } catch (error) {
    logger.error('Failed to initialize workflow', { error: error.message });
    throw error;
  }
}
