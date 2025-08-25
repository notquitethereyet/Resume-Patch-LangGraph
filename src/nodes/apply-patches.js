import { logger } from '../utils/logger.js';
import { ProcessingError } from '../utils/error-handler.js';

export async function applyPatchesNode(state) {
  logger.info('✅ Applying patches to resume...');
  
  try {
    // Validate required data
    if (!state.patches || state.patches.length === 0) {
      logger.warn('No patches to apply');
      return {
        ...state,
        resume: {
          ...state.resume,
          patched: false,
          appliedPatches: []
        }
      };
    }
    
    const resumeJson = state.resume?.content?.jsonResume;
    const resumeSections = state.resume?.content?.sections || getResumeSectionsFromJsonResume(resumeJson);
    if (!resumeSections) {
      throw new ProcessingError('Resume content not available for patch application');
    }
    
    // Apply patches to resume content
    const { updatedSections, appliedPatches, failedPatches } = applyPatchesToResume(
      state.patches, 
      resumeSections
    );
    
    // Create patched resume
    const patchedResume = {
      ...state.resume,
      patched: true,
      content: {
        ...state.resume.content,
        sections: updatedSections,
        originalSections: resumeSections
      },
      appliedPatches,
      failedPatches,
      patchedAt: new Date().toISOString()
    };
    
    logger.info('Patches applied successfully', { 
      appliedCount: appliedPatches.length,
      failedCount: failedPatches.length,
      totalPatches: state.patches.length
    });
    
    return {
      ...state,
      resume: patchedResume
    };
  } catch (error) {
    logger.error('Failed to apply patches', { error: error.message });
    throw new ProcessingError(`Failed to apply patches: ${error.message}`, { 
      originalError: error.message 
    });
  }
}

function applyPatchesToResume(patches, resumeSections) {
  const updatedSections = { ...resumeSections };
  const appliedPatches = [];
  const failedPatches = [];
  
  patches.forEach(patch => {
    try {
      const result = applySinglePatch(patch, updatedSections);
      if (result.success) {
        updatedSections[result.section] = result.updatedContent;
        appliedPatches.push({
          ...patch,
          appliedAt: new Date().toISOString(),
          result: result
        });
        logger.debug('Patch applied successfully', { patchId: patch.id, type: patch.type });
      } else {
        failedPatches.push({
          ...patch,
          failedAt: new Date().toISOString(),
          reason: result.reason
        });
        logger.warn('Patch failed to apply', { patchId: patch.id, reason: result.reason });
      }
    } catch (error) {
      failedPatches.push({
        ...patch,
        failedAt: new Date().toISOString(),
        reason: error.message
      });
      logger.error('Error applying patch', { patchId: patch.id, error: error.message });
    }
  });
  
  return { updatedSections, appliedPatches, failedPatches };
}

function applySinglePatch(patch, resumeSections) {
  switch (patch.type) {
    case 'add_skill':
      return applySkillPatch(patch, resumeSections);
    
    case 'enhance_section':
      return applyEnhancementPatch(patch, resumeSections);
    
    case 'enhance_experience':
      return applyExperiencePatch(patch, resumeSections);
    
    case 'add_content':
      return applyContentPatch(patch, resumeSections);
    
    case 'add_keyword':
      return applyKeywordPatch(patch, resumeSections);
    
    case 'recommendation_based':
      return applyRecommendationPatch(patch, resumeSections);
    
    default:
      return {
        success: false,
        reason: `Unknown patch type: ${patch.type}`
      };
  }
}

function applySkillPatch(patch, resumeSections) {
  const skillsSection = resumeSections.skills || '';
  const newSkill = patch.details.value;
  
  if (skillsSection.toLowerCase().includes(newSkill.toLowerCase())) {
    return {
      success: false,
      reason: 'Skill already exists in resume'
    };
  }
  
  let updatedSkills = skillsSection;
  if (updatedSkills.trim()) {
    updatedSkills += ', ' + newSkill;
  } else {
    updatedSkills = newSkill;
  }
  
  return {
    success: true,
    section: 'skills',
    updatedContent: updatedSkills,
    changes: { added: newSkill }
  };
}

function applyEnhancementPatch(patch, resumeSections) {
  const targetSection = patch.details.action.includes('skills') ? 'skills' : 'experience';
  const currentContent = resumeSections[targetSection] || '';
  
  if (patch.details.action.includes('expand')) {
    // Add more specific details
    const enhancements = [
      'with version control and best practices',
      'including modern frameworks and tools',
      'with focus on scalability and performance'
    ];
    
    const enhancement = enhancements[Math.floor(Math.random() * enhancements.length)];
    const updatedContent = currentContent + '. ' + enhancement;
    
    return {
      success: true,
      section: targetSection,
      updatedContent,
      changes: { enhanced: enhancement }
    };
  }
  
  return {
    success: false,
    reason: 'Enhancement type not supported'
  };
}

function applyExperiencePatch(patch, resumeSections) {
  const experienceSection = resumeSections.experience || '';
  
  if (patch.details.action.includes('emphasize')) {
    // Add emphasis to existing experience
    const emphasis = ' (Key achievement: Relevant to target role)';
    const updatedContent = experienceSection + emphasis;
    
    return {
      success: true,
      section: 'experience',
      updatedContent,
      changes: { emphasized: emphasis }
    };
  }
  
  return {
    success: false,
    reason: 'Experience enhancement type not supported'
  };
}

function applyContentPatch(patch, resumeSections) {
  if (patch.details.action.includes('add_project_section')) {
    const projectsSection = resumeSections.projects || '';
    const newProject = 'Relevant Project: Developed scalable solution with measurable outcomes';
    
    const updatedContent = projectsSection ? projectsSection + '\n' + newProject : newProject;
    
    return {
      success: true,
      section: 'projects',
      updatedContent,
      changes: { added: newProject }
    };
  }
  
  return {
    success: false,
    reason: 'Content addition type not supported'
  };
}

function applyKeywordPatch(patch, resumeSections) {
  const keyword = patch.details.value;
  const targetSection = 'skills'; // Default to skills section for keywords
  const currentContent = resumeSections[targetSection] || '';
  
  if (currentContent.toLowerCase().includes(keyword.toLowerCase())) {
    return {
      success: false,
      reason: 'Keyword already exists in resume'
    };
  }
  
  const updatedContent = currentContent ? currentContent + ', ' + keyword : keyword;
  
  return {
    success: true,
    section: targetSection,
    updatedContent,
    changes: { added: keyword }
  };
}

function applyRecommendationPatch(patch, resumeSections) {
  // Apply recommendation-based patches by delegating to specific patch types
  const recommendation = patch.details.value;
  
  if (recommendation.includes('Add missing skills')) {
    // Extract skills from recommendation
    const skillsMatch = recommendation.match(/Add missing skills: (.+)/);
    if (skillsMatch) {
      const skills = skillsMatch[1].split(', ');
      const skillsSection = resumeSections.skills || '';
      const updatedSkills = skillsSection ? skillsSection + ', ' + skills.join(', ') : skills.join(', ');
      
      return {
        success: true,
        section: 'skills',
        updatedContent: updatedSkills,
        changes: { added: skills }
      };
    }
  }
  
  return {
    success: false,
    reason: 'Recommendation type not supported'
  };
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
