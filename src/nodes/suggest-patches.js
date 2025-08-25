import { logger } from '../utils/logger.js';
import { ProcessingError } from '../utils/error-handler.js';

export async function suggestPatchesNode(state) {
  logger.info('💡 Generating patch suggestions...');
  
  try {
    // Validate required data
    if (!state.analysis) {
      throw new ProcessingError('Analysis not available for patch generation');
    }
    
    const resumeJson = state.resume?.content?.jsonResume;
    const resumeSections = state.resume?.content?.sections || getResumeSectionsFromJsonResume(resumeJson);
    if (!resumeSections) {
      throw new ProcessingError('Resume content not available for patch generation');
    }
    
    // Generate patches based on analysis
    const patches = generatePatches(state.analysis, resumeSections);
    
    logger.info('Patches generated successfully', { 
      patchCount: patches.length,
      highPriorityCount: patches.filter(p => p.priority === 'high').length
    });
    
    return {
      ...state,
      patches,
      patchGenerationCompleted: new Date().toISOString()
    };
  } catch (error) {
    logger.error('Failed to generate patches', { error: error.message });
    throw new ProcessingError(`Failed to generate patches: ${error.message}`, { 
      originalError: error.message 
    });
  }
}

function getResumeSectionsFromJsonResume(json) {
  if (!json || typeof json !== 'object') return null;
  const basics = json.basics || {};
  const work = Array.isArray(json.work) ? json.work : [];
  const education = Array.isArray(json.education) ? json.education : [];
  const skills = Array.isArray(json.skills) ? json.skills : [];

  const basicsText = [basics.name, basics.email, basics.phone, basics.summary].filter(Boolean).join(' ');
  const workText = work.map(w => [w.position, w.company, w.location, w.summary, (w.highlights || []).join(' ')].filter(Boolean).join(' ')).join('\n');
  const educationText = education.map(e => [e.institution, e.area, e.studyType, e.degree].filter(Boolean).join(' ')).join('\n');
  const skillsText = skills.map(s => (typeof s === 'string' ? s : s.name)).filter(Boolean).join(', ');

  return {
    basics: basicsText,
    experience: workText,
    education: educationText,
    skills: skillsText
  };
}

function generatePatches(analysis, resumeSections) {
  const patches = [];
  
  // Skills patches
  if (analysis.skillGaps && analysis.skillGaps.length > 0) {
    patches.push(...generateSkillPatches(analysis.skillGaps, resumeSections.skills || ''));
  }
  
  // Experience patches
  if (analysis.experienceMatch && !analysis.experienceMatch.match) {
    patches.push(...generateExperiencePatches(analysis.experienceMatch, resumeSections.experience || ''));
  }
  
  // Content optimization patches
  if (analysis.recommendations) {
    patches.push(...generateContentPatches(analysis.recommendations, resumeSections));
  }
  
  // Keyword optimization patches
  if (analysis.keywordAnalysis?.missing) {
    patches.push(...generateKeywordPatches(analysis.keywordAnalysis.missing, resumeSections));
  }
  
  // Sort patches by priority and impact
  return patches.sort((a, b) => {
    const priorityOrder = { high: 3, medium: 2, low: 1 };
    return priorityOrder[b.priority] - priorityOrder[a.priority];
  });
}

function generateSkillPatches(skillGaps, currentSkills) {
  const patches = [];
  
  // Add missing skills
  skillGaps.forEach(skill => {
    patches.push({
      id: `skill_${skill.toLowerCase().replace(/\s+/g, '_')}`,
      type: 'add_skill',
      priority: 'high',
      description: `Add skill: ${skill}`,
      details: {
        action: 'add_to_skills_section',
        value: skill,
        category: 'technical_skills',
        impact: 'High impact on match score'
      },
      estimatedEffort: 'low',
      confidence: 0.9
    });
  });
  
  // Enhance existing skills section
  if (currentSkills.length < 200) {
    patches.push({
      id: 'enhance_skills_section',
      type: 'enhance_section',
      priority: 'medium',
      description: 'Enhance skills section with more specific technologies',
      details: {
        action: 'expand_skills_description',
        value: 'Add specific versions, frameworks, and tools',
        category: 'content_enhancement',
        impact: 'Medium impact on match score'
      },
      estimatedEffort: 'medium',
      confidence: 0.7
    });
  }
  
  return patches;
}

function generateExperiencePatches(experienceMatch, currentExperience) {
  const patches = [];
  
  if (experienceMatch.reason.includes('more years')) {
    const yearsNeeded = parseInt(experienceMatch.reason.match(/(\d+)/)?.[1] || '1');
    
    patches.push({
      id: 'highlight_experience',
      type: 'enhance_experience',
      priority: 'medium',
      description: `Highlight relevant experience to compensate for ${yearsNeeded} year gap`,
      details: {
        action: 'emphasize_relevant_experience',
        value: 'Focus on most relevant projects and achievements',
        category: 'experience_optimization',
        impact: 'Medium impact on match score'
      },
      estimatedEffort: 'medium',
      confidence: 0.8
    });
  }
  
  // Add project-based experience if lacking
  if (!currentExperience.includes('project') && !currentExperience.includes('achievement')) {
    patches.push({
      id: 'add_project_experience',
      type: 'add_content',
      priority: 'low',
      description: 'Add project-based experience and achievements',
      details: {
        action: 'add_project_section',
        value: 'Include relevant projects with measurable outcomes',
        category: 'content_addition',
        impact: 'Low impact on match score'
      },
      estimatedEffort: 'high',
      confidence: 0.6
    });
  }
  
  return patches;
}

function generateContentPatches(recommendations, resumeSections) {
  const patches = [];
  
  recommendations.forEach(rec => {
    if (rec.type === 'add_skills') {
      patches.push({
        id: `rec_${rec.type}_${Date.now()}`,
        type: 'recommendation_based',
        priority: rec.priority,
        description: rec.description,
        details: {
          action: 'follow_recommendation',
          value: rec.description,
          category: 'analysis_recommendation',
          impact: rec.impact
        },
        estimatedEffort: 'medium',
        confidence: 0.8
      });
    }
  });
  
  return patches;
}

function generateKeywordPatches(missingKeywords, resumeSections) {
  const patches = [];
  
  // Add missing keywords to relevant sections
  const relevantKeywords = missingKeywords.slice(0, 10) // Limit to top 10
    .map(k => k.replace(/-/g, ' ')); // Present multi-word tokens nicely
  
  relevantKeywords.forEach(keyword => {
    patches.push({
      id: `keyword_${keyword.toLowerCase().replace(/\s+/g, '_')}`,
      type: 'add_keyword',
      priority: 'medium',
      description: `Incorporate keyword: ${keyword}`,
      details: {
        action: 'add_keyword_to_content',
        value: keyword,
        category: 'seo_optimization',
        impact: 'Medium impact on keyword matching'
      },
      estimatedEffort: 'low',
      confidence: 0.7
    });
  });
  
  return patches;
}
