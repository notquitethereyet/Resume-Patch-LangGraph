import { logger } from '../utils/logger.js';
import { ProcessingError } from '../utils/error-handler.js';
import pkg from 'fast-json-patch';
const { applyPatch } = pkg;

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
      const jsonResult = await applyPatchesToJsonResume(state.approvedPatches, resumeJson);
      updatedJson = jsonResult.updatedJson;
      appliedPatches = jsonResult.appliedPatches;
      failedPatches = jsonResult.failedPatches;
    }

    // Always maintain text sections for downstream consumers by deriving from JSON when available
    const baseSections = updatedJson ? getResumeSectionsFromJsonResume(updatedJson) : resumeSections;
    
    // Log section updates for debugging
    if (updatedJson && appliedPatches.length > 0) {
      logger.debug('Updated sections from JSON after patches', {
        originalSkillsLength: resumeSections.skills?.length || 0,
        updatedSkillsLength: baseSections.skills?.length || 0,
        jsonSkillsGroups: updatedJson.skills?.length || 0
      });
    }
    
    const textResult = await applyPatchesToResume(
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
      totalApprovedPatches: state.approvedPatches.length,
      appliedPatchTypes: appliedPatches.map(p => p.type),
      failedPatchTypes: failedPatches.map(p => ({ type: p.type, reason: p.reason }))
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

async function applyPatchesToResume(patches, resumeSections) {
  const updatedSections = { ...resumeSections };
  const appliedPatches = [];
  const failedPatches = [];
  
  for (const patch of patches) {
    try {
      const result = await applySinglePatch(patch, updatedSections);
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
  }
  
  return { updatedSections, appliedPatches, failedPatches };
}

// Apply RFC6902 patches to jsonResume where available, with safe fallback per-op
async function applyPatchesToJsonResume(patches, jsonResume) {
  const updatedJson = JSON.parse(JSON.stringify(jsonResume));
  const appliedPatches = [];
  const failedPatches = [];

  for (const patch of patches) {
    try {
      let ops = Array.isArray(patch.jsonPatch) ? patch.jsonPatch : null;
      if (!ops || ops.length === 0) {
        // Try to synthesize ops for supported types
        ops = await buildJsonPatchOpsForPatch(patch, updatedJson);
      }
      if (!ops || ops.length === 0) throw new Error('No JSON Patch ops available');
      
      logger.debug('Applying JSON patch', { patchId: patch.id, patchType: patch.type, opsCount: ops.length });
      
      // Validate and apply atomically; if it throws, mark failed and continue
      applyPatch(updatedJson, ops, /*validate*/ true);
      appliedPatches.push({
        ...patch,
        appliedAt: new Date().toISOString(),
        result: { success: true, section: 'json', updatedContent: null, changes: { ops: ops.length } }
      });
      
      logger.debug('JSON patch applied successfully', { patchId: patch.id, patchType: patch.type });
    } catch (e) {
      logger.warn('JSON patch failed for patch', { id: patch.id, type: patch.type, reason: e.message, stack: e.stack });
      failedPatches.push({ ...patch, failedAt: new Date().toISOString(), reason: e.message });
    }
  }

  return { updatedJson, appliedPatches, failedPatches };
}

// Dynamic group selection: use AI to intelligently categorize skills into existing categories
async function pickSkillsGroupIndexForKeyword(skills, keyword) {
  const list = Array.isArray(skills) ? skills : [];
  if (list.length === 0) return 0;
  const kw = String(keyword || '').trim();
  const lower = kw.toLowerCase();

  // 1) If a group already contains this keyword (case-insensitive), return that group
  for (let i = 0; i < list.length; i++) {
    const arr = Array.isArray(list[i]?.keywords) ? list[i].keywords : [];
    if (arr.some(k => String(k).toLowerCase() === lower)) return i;
  }

  // 2) Use AI to determine the best category for the new skill
  try {
    const { OpenAI } = await import('openai');
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) throw new Error('OpenAI API key not available');
    
    const client = new OpenAI({ apiKey });
    
    const categoryDescriptions = list.map((group, idx) => {
      const name = group?.name || `Category ${idx + 1}`;
      const keywords = Array.isArray(group?.keywords) ? group.keywords : [];
      const sampleKeywords = keywords.slice(0, 8).join(', ');
      return `${idx}: "${name}" - skills: [${sampleKeywords}${keywords.length > 8 ? '...' : ''}]`;
    }).join('\n');
    
    const prompt = `You are an expert at categorizing technical skills. Analyze the following skill categories and determine which one best fits the new skill.

EXISTING SKILL CATEGORIES:
${categoryDescriptions}

NEW SKILL TO CATEGORIZE: "${kw}"

Instructions:
1. Choose the category that is most semantically and technically related to the new skill
2. Consider the existing skills in each category to understand its domain
3. Prefer categories that already contain similar or related technologies
4. Return ONLY the category index number (0, 1, 2, etc.)

Best category index:`;
    
    const response = await client.chat.completions.create({
      model: process.env.OPENAI_MODEL,
      messages: [{ role: 'user', content: prompt }],
      max_completion_tokens: 10,
      temperature: 0.1
    });
    
    const categoryIndex = parseInt(response.choices[0]?.message?.content?.trim() || '0');
    const validIndex = isNaN(categoryIndex) || categoryIndex >= list.length ? 0 : categoryIndex;
    
    logger.debug('AI categorized skill', { 
      skill: kw, 
      selectedCategory: list[validIndex]?.name, 
      categoryIndex: validIndex 
    });
    
    return validIndex;
    
  } catch (error) {
    logger.warn('AI skill categorization failed, using similarity fallback', { error: error.message });
    
    // 3) Fallback: similarity scoring with improved algorithm
    const tokenize = (s) => String(s || '').toLowerCase().split(/[^a-z0-9.+#/-]+/).filter(Boolean);
    const kwTokens = new Set(tokenize(kw));
    let bestIdx = 0;
    let bestScore = -1;
    
    for (let i = 0; i < list.length; i++) {
      const arr = Array.isArray(list[i]?.keywords) ? list[i].keywords : [];
      let score = 0;
      
      // Enhanced scoring: exact matches, substring matches, and token overlap
      for (const k of arr) {
        const keywordLower = String(k).toLowerCase();
        
        // Exact match gets highest score
        if (keywordLower === lower) {
          score += 100;
        }
        // Substring matches get medium score
        else if (keywordLower.includes(lower) || lower.includes(keywordLower)) {
          score += 50;
        }
        // Token overlap gets lower score
        else {
          const tokens = tokenize(k);
          for (const t of tokens) {
            if (kwTokens.has(t)) score += 10;
          }
        }
      }
      
      // Bonus for category name relevance
      const categoryName = String(list[i]?.name || '').toLowerCase();
      if (categoryName.includes(lower) || lower.includes(categoryName)) {
        score += 25;
      }
      
      if (score > bestScore) { 
        bestScore = score; 
        bestIdx = i; 
      }
    }
    
    return bestIdx;
  }
}

function ensureSkillsArrayExists(root) {
  if (!Array.isArray(root.skills)) root.skills = [];
}

function ensureGroupKeywordsArrayExists(root, idx) {
  if (!root.skills[idx]) root.skills[idx] = { name: 'Skills', keywords: [] };
  if (!Array.isArray(root.skills[idx].keywords)) root.skills[idx].keywords = [];
}

async function buildJsonPatchOpsForPatch(patch, root) {
  try {
    if (!root || typeof root !== 'object') return [];
    switch (patch.type) {
      case 'add_skill':
      case 'add_keyword': {
        const kw = patch?.details?.value;
        if (!kw) return [];
        ensureSkillsArrayExists(root);
        const idx = await pickSkillsGroupIndexForKeyword(root.skills, kw);
        ensureGroupKeywordsArrayExists(root, idx);
        return [
          { op: 'add', path: `/skills/${idx}/keywords/-`, value: kw }
        ];
      }
      case 'role_enhancement':
      case 'align_experience': {
        // Add to work experience highlights
        const enhancementText = patch?.details?.value;
        if (!enhancementText || !Array.isArray(root.work) || root.work.length === 0) return [];
        
        // Add to the most recent work entry's highlights
        const workIdx = root.work.length - 1;
        if (!Array.isArray(root.work[workIdx].highlights)) {
          root.work[workIdx].highlights = [];
        }
        return [
          { op: 'add', path: `/work/${workIdx}/highlights/-`, value: enhancementText }
        ];
      }
      case 'enhance_experience': {
        // Add emphasis to the most recent work entry's summary
        const enhancementText = patch?.details?.value || 'Key achievement: Relevant to target role';
        if (!Array.isArray(root.work) || root.work.length === 0) return [];
        
        const workIdx = root.work.length - 1;
        const currentSummary = root.work[workIdx].summary || '';
        const updatedSummary = currentSummary ? `${currentSummary}. ${enhancementText}` : enhancementText;
        
        return [
          { op: 'replace', path: `/work/${workIdx}/summary`, value: updatedSummary }
        ];
      }
      default:
        return [];
    }
  } catch {
    return [];
  }
}

async function applySinglePatch(patch, resumeSections) {
  switch (patch.type) {
    case 'add_skill':
      return await applySkillPatch(patch, resumeSections);
    
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
      return await applyKeywordPatch(patch, resumeSections);
    
    case 'recommendation_based':
      return applyRecommendationPatch(patch, resumeSections);
    
    default:
      return {
        success: false,
        reason: `Unknown patch type: ${patch.type}`
      };
  }
}

async function applySkillPatch(patch, resumeSections) {
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
    const targetIdx = await pickGroupForSkill(groups, newSkill);
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

async function applyKeywordPatch(patch, resumeSections) {
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
    const targetIdx = await pickGroupForSkill(groups, keyword);
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
  const skillsText = skills
    .map(s => {
      if (typeof s === 'string') return s;
      const name = s?.name || '';
      const kws = Array.isArray(s?.keywords) ? s.keywords.filter(Boolean).join(', ') : '';
      return name && kws ? `${name}: ${kws}` : name;
    })
    .filter(Boolean)
    .join('\n');

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
  // Enforce category limit and consolidate if needed
  const consolidatedGroups = enforceCategoryLimit(groups);
  return consolidatedGroups
    .map(g => `• ${g.name}: ${dedupeCaseInsensitive(g.keywords).join(', ')}.`)
    .join('\n');
}

// Enforce the 3-4 category limit by consolidating similar categories
function enforceCategoryLimit(groups, maxCategories = 4) {
  if (groups.length <= maxCategories) return groups;
  
  logger.info(`Consolidating ${groups.length} skill categories to ${maxCategories} to maintain resume clarity`);
  
  // Sort groups by keyword count (preserve larger, more established categories)
  const sortedGroups = [...groups].sort((a, b) => b.keywords.length - a.keywords.length);
  
  // Keep the top categories
  const keptCategories = sortedGroups.slice(0, maxCategories - 1);
  const mergeCandidates = sortedGroups.slice(maxCategories - 1);
  
  // Merge remaining categories into the most similar existing category
  for (const candidate of mergeCandidates) {
    let bestMatch = keptCategories[0];
    let bestScore = 0;
    
    // Find the most similar category to merge into
    for (const existing of keptCategories) {
      const score = calculateCategorySimilarity(candidate, existing);
      if (score > bestScore) {
        bestScore = score;
        bestMatch = existing;
      }
    }
    
    // Merge the candidate into the best match
    logger.debug(`Merging category "${candidate.name}" into "${bestMatch.name}"`, {
      candidateSkills: candidate.keywords.length,
      targetSkills: bestMatch.keywords.length,
      similarityScore: bestScore
    });
    
    bestMatch.keywords = dedupeCaseInsensitive([...bestMatch.keywords, ...candidate.keywords]);
  }
  
  return keptCategories;
}

// Calculate similarity between two skill categories
function calculateCategorySimilarity(cat1, cat2) {
  const keywords1 = new Set(cat1.keywords.map(k => k.toLowerCase()));
  const keywords2 = new Set(cat2.keywords.map(k => k.toLowerCase()));
  
  // Calculate Jaccard similarity (intersection / union)
  const intersection = new Set([...keywords1].filter(k => keywords2.has(k)));
  const union = new Set([...keywords1, ...keywords2]);
  
  const jaccardSim = intersection.size / union.size;
  
  // Add name similarity bonus
  const name1 = cat1.name.toLowerCase();
  const name2 = cat2.name.toLowerCase();
  const nameBonus = (name1.includes(name2) || name2.includes(name1)) ? 0.2 : 0;
  
  return jaccardSim + nameBonus;
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

async function pickGroupForSkill(groups, skill) {
  if (groups.length === 0) return 0;
  
  try {
    const { OpenAI } = await import('openai');
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) throw new Error('OpenAI API key not available');
    
    const client = new OpenAI({ apiKey });
    
    const groupDescriptions = groups.map((g, idx) => 
      `${idx}: "${g.name}" - existing skills: [${g.keywords.slice(0, 10).join(', ')}${g.keywords.length > 10 ? '...' : ''}]`
    ).join('\n');
    
    const prompt = `You are an expert at categorizing technical skills. Given the following existing skill categories and a new skill to add, determine which category best fits the new skill.

EXISTING CATEGORIES:
${groupDescriptions}

NEW SKILL TO CATEGORIZE: "${skill}"

Rules:
1. Choose the category that is most semantically related to the new skill
2. Consider the existing skills in each category to understand the category's scope
3. If the skill is clearly related to multiple categories, pick the most specific one
4. Return ONLY the category index number (0, 1, 2, etc.)

Category index:`;
    
    const response = await client.chat.completions.create({
      model: process.env.OPENAI_MODEL,
      messages: [{ role: 'user', content: prompt }],
      max_completion_tokens: 10,
      temperature: 0.1
    });
    
    const categoryIndex = parseInt(response.choices[0]?.message?.content?.trim() || '0');
    return isNaN(categoryIndex) || categoryIndex >= groups.length ? 0 : categoryIndex;
    
  } catch (error) {
    logger.warn('AI-powered skill categorization failed, using fallback', { error: error.message });
    // Fallback: find best match by keyword similarity
    const s = String(skill).toLowerCase();
    let bestIdx = 0;
    let bestScore = -1;
    
    for (let i = 0; i < groups.length; i++) {
      const groupKeywords = groups[i].keywords.map(k => k.toLowerCase());
      let score = 0;
      
      // Check for exact matches or substring matches
      for (const keyword of groupKeywords) {
        if (keyword === s) score += 10;
        else if (keyword.includes(s) || s.includes(keyword)) score += 5;
        else {
          // Token overlap scoring
          const skillTokens = s.split(/[^a-z0-9]+/).filter(Boolean);
          const keywordTokens = keyword.split(/[^a-z0-9]+/).filter(Boolean);
          const overlap = skillTokens.filter(t => keywordTokens.includes(t)).length;
          score += overlap;
        }
      }
      
      if (score > bestScore) {
        bestScore = score;
        bestIdx = i;
      }
    }
    
    return bestIdx;
  }
}
