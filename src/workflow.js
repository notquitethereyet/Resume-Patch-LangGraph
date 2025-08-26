import { StateGraph, END } from '@langchain/langgraph';
import { startNode } from './nodes/start.js';
import { fetchJDNode } from './nodes/fetch-jd.js';
import { parseResumeNode } from './nodes/parse-resume.js';
import { analyzeNode } from './nodes/analyze.js';
import { suggestPatchesNode } from './nodes/suggest-patches.js';
import { approvePatchesNode } from './nodes/approve-patches.js';
import { applyPatchesNode } from './nodes/apply-patches.js';
import { exportNode } from './nodes/export.js';

// Public state shape expected by tests and external consumers
export const ResumeState = {
  resume: null,
  jobDescription: { url: null, text: null },
  analysis: { keywords: [], matchScore: 0 },
  patches: [],
  approvedPatches: [],
  output: { path: null, finalResume: null },
  error: { messages: [], retryCount: 0 }
};

// Create the workflow graph
export function createWorkflow() {
  // Initialize graph with proper state structure for LangGraph.js
  const workflow = new StateGraph({
    channels: {
      resume_path: { reducer: (_l, r) => r, default: () => null },
      jd_url: { reducer: (_l, r) => r, default: () => null },
      jd_text: { reducer: (_l, r) => r, default: () => null },
      jobDescription: { reducer: (_l, r) => r, default: () => null },
      resume: { reducer: (_l, r) => r, default: () => null },
      resume_json: { reducer: (_l, r) => r, default: () => null },
      analysis: { reducer: (_l, r) => r, default: () => null },
      keywords: { reducer: (l = [], r) => l.concat(r || []), default: () => [] },
      match_score: { reducer: (_l, r) => r, default: () => 0.0 },
      patches: { reducer: (l = [], r) => l.concat(r || []), default: () => [] },
      approvedPatches: { reducer: (_l, r) => r, default: () => [] },
      final_resume: { reducer: (_l, r) => r, default: () => null },
      processing_log: { reducer: (l = [], r) => l.concat(r || []), default: () => [] },
      errors: { reducer: (l = [], r) => l.concat(r || []), default: () => [] },
      retry_count: { reducer: (_l, r) => r, default: () => 0 },
      current_step: { reducer: (_l, r) => r, default: () => 'start' },
      start_time: { reducer: (_l, r) => r, default: () => null },
      step_timings: { reducer: (l = {}, r = {}) => ({ ...l, ...r }), default: () => ({}) },
      output_path: { reducer: (_l, r) => r, default: () => null },
      allow_disk: { reducer: (_l, r) => r, default: () => false },
      auto_apply: { reducer: (_l, r) => r, default: () => false },
      output: { reducer: (_l, r) => r, default: () => null }
    }
  });

  // Add nodes
  workflow
    .addNode("start", startNode)
    .addNode("parse_resume", parseResumeNode)
    .addNode("fetch_jd", fetchJDNode)
    .addNode("analyze", analyzeNode)
    .addNode("suggest_patches", suggestPatchesNode)
    .addNode("approve_patches", approvePatchesNode)
    .addNode("apply_patches", applyPatchesNode)
    .addNode("export", exportNode)
    .addNode("handle_error", handleErrorNode)
    .addNode("retry_parse", retryParseNode)
    .addNode("retry_fetch", retryFetchNode);

  // Define the flow with improved conditional logic
  workflow.setEntryPoint("start");
  
  // Start -> Parse Resume (always)
  workflow.addEdge("start", "parse_resume");
  
  // Parse Resume -> Conditional flow based on success
  workflow.addConditionalEdges(
    "parse_resume",
    (state) => {
      if (state.errors && state.errors.length > 0) {
        if (state.retry_count < 2) {
          return "retry_parse";
        } else {
          return "handle_error";
        }
      }
      
      // Check if resume was successfully parsed
      if (state.resume && state.resume.parsed && state.resume.content) {
        return "fetch_jd";
      } else {
        return "handle_error";
      }
    },
    {
      "retry_parse": "retry_parse",
      "fetch_jd": "fetch_jd",
      "handle_error": "handle_error"
    }
  );
  
  // Retry Parse -> Parse Resume (with incremented retry count)
  workflow.addEdge("retry_parse", "parse_resume");
  
  // Fetch JD -> Conditional flow based on success
  workflow.addConditionalEdges(
    "fetch_jd",
    (state) => {
      if (state.errors && state.errors.length > 0) {
        if (state.retry_count < 2) {
          return "retry_fetch";
        } else {
          return "handle_error";
        }
      }
      
      // Check if JD was successfully fetched
      if (state.jd_text && state.jd_text.length > 0) {
        return "analyze";
      } else {
        return "handle_error";
      }
    },
    {
      "retry_fetch": "retry_fetch",
      "analyze": "analyze",
      "handle_error": "handle_error"
    }
  );
  
  // Retry Fetch -> Fetch JD (with incremented retry count)
  workflow.addEdge("retry_fetch", "fetch_jd");
  
  // Analyze -> Proceed to suggestions without looping to avoid recursion
  workflow.addConditionalEdges(
    "analyze",
    (state) => {
      if (state.errors && state.errors.length > 0) {
        return "handle_error";
      }
      
      return "suggest_patches";
    },
    {
      "suggest_patches": "suggest_patches",
      "handle_error": "handle_error"
    }
  );
  
  // Suggest Patches -> Conditional flow based on patch generation
  workflow.addConditionalEdges(
    "suggest_patches",
    (state) => {
      if (state.errors && state.errors.length > 0) {
        return "handle_error";
      }
      
      if (state.patches && state.patches.length > 0) {
        return "approve_patches";
      } else {
        // No patches generated, skip to export
        return "export";
      }
    },
    {
      "approve_patches": "approve_patches",
      "export": "export"
    }
  );
  
  // Approve Patches -> Apply Patches (always, even if no patches approved)
  workflow.addEdge("approve_patches", "apply_patches");
  
  // Apply Patches -> Export (always, even if some patches failed)
  workflow.addEdge("apply_patches", "export");
  
  // Export -> END
  workflow.addConditionalEdges(
    "export",
    (state) => {
      if (state.errors && state.errors.length > 0) {
        return "handle_error";
      }
      return "end";
    },
    {
      "end": END,
      "handle_error": "handle_error"
    }
  );
  
  // Handle Error -> END (with error state)
  workflow.addEdge("handle_error", END);

  // Compile the workflow and return the compiled version
  return workflow.compile();
}

// Enhanced error handling node with logging
async function handleErrorNode(state) {
  const errorInfo = {
    step: state.current_step,
    timestamp: new Date().toISOString(),
    errors: state.errors,
    retry_count: state.retry_count
  };
  
  console.error('❌ Workflow error encountered:', errorInfo);
  
  return {
    ...state,
    processing_log: [...(state.processing_log || []), `Error at ${state.current_step}: ${JSON.stringify(errorInfo)}`],
    errorHandledAt: new Date().toISOString()
  };
}

// Enhanced retry parse node with performance tracking
async function retryParseNode(state) {
  console.log('🔄 Retrying resume parsing...');
  
  return {
    ...state,
    retry_count: (state.retry_count || 0) + 1,
    errors: [], // Clear previous errors
    current_step: 'retry_parse',
    processing_log: [...(state.processing_log || []), `Retry parse attempt ${state.retry_count}`]
  };
}

// Enhanced retry fetch node with performance tracking
async function retryFetchNode(state) {
  console.log('🔄 Retrying job description fetch...');
  
  return {
    ...state,
    retry_count: (state.retry_count || 0) + 1,
    errors: [], // Clear previous errors
    current_step: 'retry_fetch',
    processing_log: [...(state.processing_log || []), `Retry fetch attempt ${state.retry_count}`]
  };
}

// Main function to run the workflow with improved state management
export async function resumePatch(resumePath, options) {
  const workflow = createWorkflow();
  
  const initialState = {
    resume_path: resumePath,
    jd_url: options.job || null,
    jd_text: options.text || null,
    allow_disk: Boolean(options.allowDisk),
    auto_apply: Boolean(options.autoApply),
    resume: null,
    resume_json: null,
    keywords: [],
    match_score: 0.0,
    patches: [],
    approvedPatches: [],
    final_resume: null,
    processing_log: [],
    errors: [],
    retry_count: 0,
    current_step: 'start',
    start_time: Date.now(),
    step_timings: {},
    output_path: options.output || 'optimized-resume'
  };

  try {
    console.log('🚀 Starting resume optimization workflow...');
    const result = await workflow.invoke(initialState);
    
    if (result.errors && result.errors.length > 0) {
      console.error('Workflow completed with errors');
      throw new Error(`Workflow failed: ${result.errors.join(', ')}`);
    }
    
    const totalTime = Date.now() - result.start_time;
    console.log(`✅ Resume optimization completed successfully in ${totalTime}ms!`);
    
    // Log performance metrics
    if (result.processing_log) {
      console.log('📊 Processing log:', result.processing_log);
    }
    
    return result;
  } catch (error) {
    console.error('Workflow failed:', error);
    throw error;
  }
}
