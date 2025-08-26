import { logger } from '../utils/logger.js';
import { ProcessingError } from '../utils/error-handler.js';
import * as jsonpatch from 'fast-json-patch';

export async function applyPatchesNode(state) {
  logger.info('✅ Applying approved patches to resume...');
  
  try {
    // Validate required data
    if (!state.approvedPatches || state.approvedPatches.length === 0) {
      logger.warn('No approved patches to apply');
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
    
    // If we have structured JSON Resume, apply patches structurally first
    let updatedJson = null;
    let appliedPatches = [];
    let failedPatches = [];
    if (resumeJson && typeof resumeJson === 'object') {
      const jsonResult = applyPatchesToJsonResume(state.approvedPatches, resumeJson);
      updatedJson = jsonResult.updatedJson;
      appliedPatches = jsonResult.appliedPatches;
      failedPatches = jsonResult.failedPatches;
    }

    // Always maintain text sections for downstream consumers by deriving from JSON when available
    const baseSections = updatedJson ? getResumeSectionsFromJsonResume(updatedJson) : resumeSections;
    const textResult = applyPatchesToResume(
      // Only apply text-based patches that were not already marked applied structurally
      state.approvedPatches.filter(p => !appliedPatches.find(ap => ap.id === p.id)),
      baseSections
    );
    const updatedSections = textResult.updatedSections;
    appliedPatches = appliedPatches.concat(textResult.appliedPatches);
    failedPatches = failedPatches.concat(textResult.failedPatches);
    
    // Create patched resume
    const patchedResume = {
      ...state.resume,
      patched: true,
      content: {
        ...state.resume.content,
        sections: updatedSections,
        originalSections: resumeSections,
        ...(updatedJson ? { jsonResume: updatedJson } : {})
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

// Apply RFC6902 patches to jsonResume where available, with safe fallback per-op
function applyPatchesToJsonResume(patches, jsonResume) {
  const updatedJson = JSON.parse(JSON.stringify(jsonResume));
  const appliedPatches = [];
  const failedPatches = [];

  patches.forEach(patch => {
    try {
      let ops = Array.isArray(patch.jsonPatch) ? patch.jsonPatch : null;
      if (!ops || ops.length === 0) {
        // Try to synthesize ops for supported types
        ops = buildJsonPatchOpsForPatch(patch, updatedJson);
      }
      if (!ops || ops.length === 0) throw new Error('No JSON Patch ops');
      // Validate and apply atomically; if it throws, mark failed and continue
      jsonpatch.applyPatch(updatedJson, ops, /*validate*/ true);
      appliedPatches.push({
        ...patch,
        appliedAt: new Date().toISOString(),
        result: { success: true, section: 'json', updatedContent: null, changes: { ops: ops.length } }
      });
    } catch (e) {
      try { logger.warn('JSON patch failed for patch', { id: patch.id, type: patch.type, reason: e.message }); } catch {}
      failedPatches.push({ ...patch, failedAt: new Date().toISOString(), reason: e.message });
    }
  });

  return { updatedJson, appliedPatches, failedPatches };
}

// Dynamic group selection: prefer an exact category name match; else pick the group whose keywords are most similar
function pickSkillsGroupIndexForKeyword(skills, keyword) {
  const list = Array.isArray(skills) ? skills : [];
  if (list.length === 0) return 0;
  const kw = String(keyword || '').trim();
  const lower = kw.toLowerCase();

  // 1) If a group already contains this keyword (case-insensitive), return that group
  for (let i = 0; i < list.length; i++) {
    const arr = Array.isArray(list[i]?.keywords) ? list[i].keywords : [];
    if (arr.some(k => String(k).toLowerCase() === lower)) return i;
  }

  // 2) If a group name explicitly mentions the keyword token, prefer it
  for (let i = 0; i < list.length; i++) {
    const name = String(list[i]?.name || '').toLowerCase();
    if (name.includes(lower)) return i;
  }

  // 3) Similarity scoring: choose the group with max token overlap to existing keywords
  const tokenize = (s) => String(s || '').toLowerCase().split(/[^a-z0-9.+#/-]+/).filter(Boolean);
  const kwTokens = new Set(tokenize(kw));
  let bestIdx = 0;
  let bestScore = -1;
  for (let i = 0; i < list.length; i++) {
    const arr = Array.isArray(list[i]?.keywords) ? list[i].keywords : [];
    let score = 0;
    for (const k of arr) {
      const tokens = tokenize(k);
      for (const t of tokens) if (kwTokens.has(t)) score += 1;
    }
    if (score > bestScore) { bestScore = score; bestIdx = i; }
  }
  return bestIdx;
}

function ensureSkillsArrayExists(root) {
  if (!Array.isArray(root.skills)) root.skills = [];
}

function ensureGroupKeywordsArrayExists(root, idx) {
  if (!root.skills[idx]) root.skills[idx] = { name: 'Skills', keywords: [] };
  if (!Array.isArray(root.skills[idx].keywords)) root.skills[idx].keywords = [];
}

function buildJsonPatchOpsForPatch(patch, root) {
  try {
    if (!root || typeof root !== 'object') return [];
    switch (patch.type) {
      case 'add_skill':
      case 'add_keyword': {
        const kw = patch?.details?.value;
        if (!kw) return [];
        ensureSkillsArrayExists(root);
        const idx = pickSkillsGroupIndexForKeyword(root.skills, kw);
        ensureGroupKeywordsArrayExists(root, idx);
        return [
          { op: 'add', path: `/skills/${idx}/keywords/-`, value: kw }
        ];
      }
      default:
        return [];
    }
  } catch {
    return [];
  }
}

function applySinglePatch(patch, resumeSections) {
  switch (patch.type) {
    case 'add_skill':
      return applySkillPatch(patch, resumeSections);
    
    case 'enhance_section':
      return applyEnhancementPatch(patch, resumeSections);
    
    case 'enhance_experience':
      return applyExperiencePatch(patch, resumeSections);
    
    case 'align_experience':
      return applyExperienceAlignmentPatch(patch, resumeSections);
    
    case 'role_enhancement':
      return applyRoleEnhancementPatch(patch, resumeSections);
    
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
  
  // Insert skill into the appropriate category line if categories exist
  const groups = extractGroupedSkillsText(skillsSection);
  if (groups.length > 0) {
    const targetIdx = pickGroupForSkill(groups, newSkill);
    const exists = groups[targetIdx].keywords.some(k => k.toLowerCase() === String(newSkill).toLowerCase());
    if (!exists) groups[targetIdx].keywords.push(newSkill);
    const updatedContent = stringifyGroupedSkills(groups);
    return {
      success: true,
      section: 'skills',
      updatedContent,
      changes: { added: newSkill, group: groups[targetIdx].name }
    };
  }

  // Fallback: append at end
  const updatedContent = (skillsSection.trim() ? skillsSection + ', ' : '') + newSkill;
  return {
    success: true,
    section: 'skills',
    updatedContent,
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
      'with focus on scalability and performance',
      'following industry best practices and standards',
      'with emphasis on code quality and maintainability',
      'utilizing agile methodologies and continuous integration'
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

function applyExperienceAlignmentPatch(patch, resumeSections) {
  const experienceSection = resumeSections.experience || '';
  const action = patch.details.action;
  const enhancementText = patch.details.value;
  
  let updatedContent = experienceSection;
  let changes = {};
  
  switch (action) {
    case 'add_technology_mention':
      // Add technology mention to existing experience
      updatedContent = experienceSection + '. ' + enhancementText;
      changes = { addedTechnology: enhancementText };
      break;
      
    case 'enhance_achievement':
      // Add achievement enhancement
      updatedContent = experienceSection + '. ' + enhancementText;
      changes = { enhancedAchievement: enhancementText };
      break;
      
    case 'emphasize_role_relevance':
      // Emphasize role relevance
      updatedContent = experienceSection + ' (Relevant to target role: ' + enhancementText + ')';
      changes = { emphasizedRelevance: enhancementText };
      break;
      
    case 'add_industry_context':
      // Add industry-specific context
      updatedContent = experienceSection + '. ' + enhancementText;
      changes = { addedIndustryContext: enhancementText };
      break;
      
    default:
      // Generic enhancement
      updatedContent = experienceSection + '. ' + enhancementText;
      changes = { enhanced: enhancementText };
  }
  
  return {
    success: true,
    section: 'experience',
    updatedContent,
    changes,
    reason: patch.details.reason
  };
}

function applyRoleEnhancementPatch(patch, resumeSections) {
  const experienceSection = resumeSections.experience || '';
  const enhancementText = patch.details.value;
  const category = patch.details.category;
  
  let updatedContent = experienceSection;
  let changes = {};
  
  // Apply the enhancement based on category
  switch (category) {
    case 'leadership_enhancement':
      updatedContent = experienceSection + '. ' + enhancementText;
      changes = { enhancedLeadership: enhancementText };
      break;
      
    case 'technology_alignment':
      updatedContent = experienceSection + '. ' + enhancementText;
      changes = { alignedTechnology: enhancementText };
      break;
      
    case 'industry_terminology':
      updatedContent = experienceSection + '. ' + enhancementText;
      changes = { addedIndustryTerminology: enhancementText };
      break;
      
    case 'achievement_enhancement':
      updatedContent = experienceSection + '. ' + enhancementText;
      changes = { enhancedAchievement: enhancementText };
      break;
      
    default:
      updatedContent = experienceSection + '. ' + enhancementText;
      changes = { enhanced: enhancementText };
  }
  
  return {
    success: true,
    section: 'experience',
    updatedContent,
    changes,
    reason: patch.details.reason
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

  // Insert into best-matching group if categorized
  const groups = extractGroupedSkillsText(currentContent);
  if (groups.length > 0) {
    const targetIdx = pickGroupForSkill(groups, keyword);
    const exists = groups[targetIdx].keywords.some(k => k.toLowerCase() === String(keyword).toLowerCase());
    if (!exists) groups[targetIdx].keywords.push(keyword);
    const updatedContent = stringifyGroupedSkills(groups);
    return {
      success: true,
      section: targetSection,
      updatedContent,
      changes: { added: keyword, group: groups[targetIdx].name }
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

// --- Helpers for categorized skills text handling ---
function extractGroupedSkillsText(text) {
  if (!text) return [];
  const lines = String(text)
    .split('\n')
    .map(l => l.replace(/^[\s•\-\u2022\u25CF\u25E6\u2023]+/, '').trim())
    .filter(l => l.length > 0);
  const groups = [];
  lines.forEach(line => {
    const m = line.match(/^(.*?):\s*(.*)$/);
    if (m) {
      const name = m[1].trim();
      const items = m[2]
        .split(/[,;/]\s*/)
        .map(s => s.replace(/\.$/, '').trim())
        .filter(Boolean);
      if (name && items.length) groups.push({ name, keywords: dedupeCaseInsensitive(items) });
    }
  });
  return groups;
}

function stringifyGroupedSkills(groups) {
  return groups
    .map(g => `• ${g.name}: ${dedupeCaseInsensitive(g.keywords).join(', ')}.`)
    .join('\n');
}

function dedupeCaseInsensitive(arr) {
  const seen = new Set();
  const out = [];
  for (const v of arr) {
    const key = String(v).toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(v);
  }
  return out;
}

function pickGroupForSkill(groups, skill) {
  const s = String(skill).toLowerCase();
  const nameIndex = new Map(groups.map((g, i) => [g.name.toLowerCase(), i]));
  const tests = [
    { group: 'backend development', match: /(python|fastapi|flask|node|express|graphql|jwt|postgres|mysql|mongodb|supabase)/ },
    { group: 'frontend development', match: /(react|angular|typescript|javascript|tailwind|html|css|wcag)/ },
    { group: 'machine learning', match: /(pytorch|tensorflow|scikit|sklearn|numpy|pandas|langchain|llm|rag|pinecone|embedding|vector)/ },
    { group: 'cloud', match: /(aws|gcp|azure|docker|kubernetes|ci\/cd|git)/ },
    { group: 'practices', match: /(agile|tdd|oop|architecture|performance|security)/ }
  ];
  for (const t of tests) {
    if (t.match.test(s)) {
      for (const [name, idx] of nameIndex.entries()) {
        if (name.includes(t.group)) return idx;
      }
    }
  }
  // Default: first group
  return 0;
}
