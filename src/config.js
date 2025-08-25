export const config = {
  // AI Model Configuration
  openai: {
    apiKey: process.env.OPENAI_API_KEY,
    model: 'gpt-4o-mini',
    temperature: 0.1,
    maxTokens: 2000
  },
  
  // Performance Settings
  performance: {
    maxTurnTime: 10000, // 10 seconds in milliseconds
    batchSize: 5,
    parallelProcessing: true
  },
  
  // File Processing
  files: {
    supportedFormats: ['.pdf', '.json'],
    maxFileSize: 10 * 1024 * 1024, // 10MB
    tempDir: './temp'
  },
  
  // Security
  security: {
    inMemoryProcessing: true,
    dataRetention: 'session-only',
    userWarnings: true
  }
};
