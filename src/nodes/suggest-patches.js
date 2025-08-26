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
    
    // Get job description for intelligent patch generation
    const jobDescription = state.jobDescription?.text || state.jobDescription?.url || '';
    if (!jobDescription) {
      logger.warn('No job description available for intelligent patch generation');
    }
    
    // Generate patches based on analysis with AI-powered filtering
    let patches = await generatePatches(state.analysis, resumeSections, jobDescription);
    
    // Intelligently limit total patches to avoid overwhelming the user
    if (patches.length > 15) {
      logger.info('Too many patches generated, applying intelligent filtering');
      patches = await aiFilterTopPatches(patches, jobDescription, 15);
    }
    
    // Log patch types for debugging
    const patchTypes = patches.reduce((acc, patch) => {
      acc[patch.type] = (acc[patch.type] || 0) + 1;
      return acc;
    }, {});
    
    logger.info('Patches generated successfully', { 
      patchCount: patches.length,
      highPriorityCount: patches.filter(p => p.priority === 'high').length,
      patchTypes,
      uniqueValues: [...new Set(patches.map(p => p.details.value?.toLowerCase()))].length
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

async function generatePatches(analysis, resumeSections, jobDescription) {
  const patches = [];
  
  // Skills patches (highest priority - these go to the skills section)
  if (analysis.skillGaps && analysis.skillGaps.length > 0) {
    const skillPatches = await generateSkillPatches(analysis.skillGaps, resumeSections.skills || '', jobDescription);
    patches.push(...skillPatches);
  }
  
  // Experience patches
  if (analysis.experienceMatch && !analysis.experienceMatch.match) {
    const experiencePatches = await generateExperiencePatches(analysis.experienceMatch, resumeSections.experience || '', jobDescription);
    patches.push(...experiencePatches);
  }
  
  // Role-specific experience enhancement (always generate if we have job description)
  if (jobDescription && resumeSections.experience) {
    try {
      const roleEnhancementPatches = await generateRoleSpecificEnhancements(resumeSections.experience, jobDescription);
      patches.push(...roleEnhancementPatches);
    } catch (error) {
      logger.warn('Failed to generate role-specific enhancements:', error.message);
    }
  }
  
  // Content optimization patches
  if (analysis.recommendations) {
    patches.push(...generateContentPatches(analysis.recommendations, resumeSections));
  }
  
  // Keyword optimization patches (only if not already covered by skills)
  if (analysis.keywordAnalysis?.missing) {
    const skillValues = patches
      .filter(p => p.type === 'add_skill')
      .map(p => p.details.value?.toLowerCase());
    
    const keywordPatches = await generateKeywordPatches(
      analysis.keywordAnalysis.missing, 
      resumeSections, 
      jobDescription,
      skillValues // Pass existing skill values to avoid duplicates
    );
    patches.push(...keywordPatches);
  }
  
  // Deduplicate and filter patches
  const deduplicatedPatches = deduplicatePatches(patches);
  
  // Sort patches by priority and impact
  return deduplicatedPatches.sort((a, b) => {
    const priorityOrder = { high: 3, medium: 2, low: 1 };
    return priorityOrder[b.priority] - priorityOrder[a.priority];
  });
}

// AI-powered patch filtering to select top patches
async function aiFilterTopPatches(patches, jobDescription, maxPatches) {
  try {
    const { OpenAI } = await import('openai');
    const apiKey = process.env.OPENAI_API_KEY;
    
    if (!apiKey) {
      throw new Error('OpenAI API key not available');
    }
    
    const client = new OpenAI({ apiKey });
    
    const patchDescriptions = patches.map((patch, index) => 
      `${index + 1}. ${patch.description} (${patch.priority} priority, ${patch.details.impact})`
    ).join('\n');
    
    const prompt = `You are an expert resume optimization specialist. Analyze the following:

JOB DESCRIPTION:
${jobDescription}

AVAILABLE PATCHES:
${patchDescriptions}

TASK: Select the top ${maxPatches} most valuable patches that would have the highest impact on improving the resume's match score for this specific job. Consider:
1. Priority level (high > medium > low)
2. Impact on match score
3. Relevance to the job requirements
4. Specificity and actionability of the patch

Return ONLY a JSON array of the patch numbers (1-based) to keep, like: [1, 3, 5, 7, 9, 11, 13, 15, 17, 19, 21, 23, 25, 27, 29]`;

    const response = await client.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.1,
      max_tokens: 200
    });

    const content = response.choices[0]?.message?.content;
    if (!content) {
      throw new Error('No response from OpenAI');
    }

    try {
      // Extract JSON array from response
      const jsonMatch = content.match(/\[.*\]/);
      if (jsonMatch) {
        const selectedIndices = JSON.parse(jsonMatch[0]);
        if (Array.isArray(selectedIndices)) {
          // Convert 1-based indices to 0-based and filter patches
          return selectedIndices
            .map(index => patches[index - 1])
            .filter(Boolean)
            .slice(0, maxPatches);
        }
      }
      throw new Error('Invalid response format');
    } catch (parseError) {
      throw new Error(`Failed to parse AI response: ${parseError.message}`);
    }
  } catch (error) {
    console.warn('Failed to use AI for patch filtering, falling back to priority-based selection:', error.message);
    // Fallback: select top patches by priority
    return patches
      .sort((a, b) => {
        const priorityOrder = { high: 3, medium: 2, low: 1 };
        return priorityOrder[b.priority] - priorityOrder[a.priority];
      })
      .slice(0, maxPatches);
  }
}

// Helper function to deduplicate patches
function deduplicatePatches(patches) {
  const seen = new Set();
  const uniquePatches = [];
  
  patches.forEach(patch => {
    // Create a key based on the patch value and type
    const key = `${patch.type}_${patch.details.value?.toLowerCase() || patch.description.toLowerCase()}`;
    
    // Also check for similar values (e.g., "React" vs "react")
    const valueKey = patch.details.value?.toLowerCase() || patch.description.toLowerCase();
    const similarKey = patches.some(existing => {
      if (existing === patch) return false;
      const existingValue = existing.details.value?.toLowerCase() || existing.description.toLowerCase();
      return valueKey.includes(existingValue) || existingValue.includes(valueKey);
    });
    
    if (!seen.has(key) && !similarKey) {
      seen.add(key);
      uniquePatches.push(patch);
    }
  });
  
  return uniquePatches;
}

async function generateSkillPatches(skillGaps, currentSkills, jobDescription) {
  const patches = [];
  
  try {
    // Use AI to intelligently filter and prioritize skills
    const relevantSkills = await aiFilterSkills(skillGaps, currentSkills, jobDescription);
    
    // Add missing skills
    relevantSkills.forEach(skill => {
      patches.push({
        id: `skill_${skill.toLowerCase().replace(/\s+/g, '_')}`,
        type: 'add_skill',
        priority: 'high',
        description: `Add specific technology: ${skill}`,
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
    
    // Only enhance skills section if we have very few skills
    if (currentSkills.length < 100 && relevantSkills.length < 3) {
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
  } catch (error) {
    console.warn('Failed to use AI for skill filtering, falling back to basic filtering:', error.message);
    // Fallback to basic filtering if AI fails
    const fallbackSkills = skillGaps
      .filter(skill => {
        const lowerSkill = skill.toLowerCase();
        return !currentSkills.toLowerCase().includes(lowerSkill) && skill.length >= 3;
      })
      .slice(0, 5);
    
    fallbackSkills.forEach(skill => {
      patches.push({
        id: `skill_${skill.toLowerCase().replace(/\s+/g, '_')}`,
        type: 'add_skill',
        priority: 'medium',
        description: `Add skill: ${skill}`,
        details: {
          action: 'add_to_skills_section',
          value: skill,
          category: 'technical_skills',
          impact: 'Medium impact on match score'
        },
        estimatedEffort: 'low',
        confidence: 0.6
      });
    });
  }
  
  return patches;
}

// AI-powered skill filtering
async function aiFilterSkills(skillGaps, currentSkills, jobDescription) {
  const { OpenAI } = await import('openai');
  const apiKey = process.env.OPENAI_API_KEY;
  
  if (!apiKey) {
    throw new Error('OpenAI API key not available');
  }
  
  const client = new OpenAI({ apiKey });
  
  const prompt = `You are an expert resume optimization specialist. Analyze the following:

JOB DESCRIPTION:
${jobDescription}

CURRENT RESUME SKILLS:
${currentSkills}

MISSING SKILLS FROM ANALYSIS:
${skillGaps.join(', ')}

TASK: Identify the top 8 most valuable and specific technical skills/technologies that should be added to the resume. Focus on:
1. Specific technologies (e.g., "React", "AWS Lambda", "PostgreSQL") not vague terms (e.g., "API", "database", "web development")
2. Skills that directly match the job requirements
3. Technologies that would significantly improve the resume's match score
4. Skills that are NOT already mentioned in the current resume content
5. Skills that are specific enough to be actionable
6. AVOID generic business terms like "Payment Systems", "Checkout Processes", "Automation", "Financial" - focus on specific technical tools, frameworks, and technologies

Return ONLY a JSON array of the top 8 skills, like: ["React", "AWS Lambda", "PostgreSQL", "TypeScript", "Docker", "Kubernetes", "GraphQL", "Redis"]`;

  const response = await client.chat.completions.create({
    model: 'gpt-4o-mini',
    messages: [{ role: 'user', content: prompt }],
    temperature: 0.1,
    max_tokens: 300
  });

  const content = response.choices[0]?.message?.content;
  if (!content) {
    throw new Error('No response from OpenAI');
  }

  try {
    // Extract JSON array from response
    const jsonMatch = content.match(/\[.*\]/);
    if (jsonMatch) {
      const skills = JSON.parse(jsonMatch[0]);
      return Array.isArray(skills) ? skills.slice(0, 8) : [];
    }
    throw new Error('Invalid response format');
  } catch (parseError) {
    throw new Error(`Failed to parse AI response: ${parseError.message}`);
  }
}

async function generateExperiencePatches(experienceMatch, currentExperience, jobDescription) {
  const patches = [];
  
  // Experience gap compensation
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
  
  // AI-powered experience alignment with job description
  try {
    const experienceAlignmentPatches = await generateExperienceAlignmentPatches(currentExperience, jobDescription);
    patches.push(...experienceAlignmentPatches);
  } catch (error) {
    logger.warn('Failed to generate AI-powered experience alignment patches:', error.message);
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

async function generateKeywordPatches(missingKeywords, resumeSections, jobDescription, existingSkillValues = []) {
  const patches = [];
  
  try {
    // Use AI to intelligently filter and prioritize keywords
    const relevantKeywords = await aiFilterKeywords(missingKeywords, resumeSections, jobDescription);
    
    relevantKeywords.forEach(keyword => {
      // Skip if this keyword is already covered by a skill patch
      if (existingSkillValues.some(skill => 
        skill && keyword.toLowerCase().includes(skill) || skill.includes(keyword.toLowerCase())
      )) {
        return;
      }
      
      patches.push({
        id: `keyword_${keyword.toLowerCase().replace(/\s+/g, '_')}`,
        type: 'add_keyword',
        priority: 'medium',
        description: `Add specific technology: ${keyword}`,
        details: {
          action: 'add_keyword_to_content',
          value: keyword,
          category: 'technical_skills',
          impact: 'Medium impact on keyword matching'
        },
        estimatedEffort: 'low',
        confidence: 0.8
      });
    });
  } catch (error) {
    console.warn('Failed to use AI for keyword filtering, falling back to basic filtering:', error.message);
    // Fallback to basic filtering if AI fails
    const fallbackKeywords = missingKeywords
      .map(k => k.replace(/-/g, ' '))
      .filter(keyword => {
        const lowerKeyword = keyword.toLowerCase();
        const resumeText = Object.values(resumeSections).join(' ').toLowerCase();
        
        // Skip if already covered by skills or resume content
        if (existingSkillValues.some(skill => 
          skill && lowerKeyword.includes(skill) || skill.includes(lowerKeyword)
        )) {
          return false;
        }
        
        return !resumeText.includes(lowerKeyword) && keyword.length >= 3;
      })
      .slice(0, 3);
    
    fallbackKeywords.forEach(keyword => {
      patches.push({
        id: `keyword_${keyword.toLowerCase().replace(/\s+/g, '_')}`,
        type: 'add_keyword',
        priority: 'low',
        description: `Add keyword: ${keyword}`,
        details: {
          action: 'add_keyword_to_content',
          value: keyword,
          category: 'keyword_optimization',
          impact: 'Low impact on keyword matching'
        },
        estimatedEffort: 'low',
        confidence: 0.5
      });
    });
  }
  
  return patches;
}

// Generate role-specific experience enhancements
async function generateRoleSpecificEnhancements(currentExperience, jobDescription) {
  const patches = [];
  
  try {
    const { OpenAI } = await import('openai');
    const apiKey = process.env.OPENAI_API_KEY;
    
    if (!apiKey) {
      throw new Error('OpenAI API key not available');
    }
    
    const client = new OpenAI({ apiKey });
    
    const prompt = `You are an expert resume optimization specialist. Analyze the following:

JOB DESCRIPTION:
${jobDescription}

CURRENT RESUME EXPERIENCE:
${currentExperience}

TASK: Generate 2-3 specific enhancements to make the experience more relevant to the target role. Focus on:

1. **Technology Stack Alignment**: Add specific technologies mentioned in the job description
2. **Industry Terminology**: Use industry-specific language from the job posting
3. **Role Responsibilities**: Emphasize experience that matches the job requirements
4. **Quantifiable Achievements**: Add metrics or outcomes that demonstrate impact

For each enhancement, provide:
- The specific text to add
- Why it improves job alignment
- The category of enhancement

Return ONLY a JSON array, like:
[
  {
    "text": "Led cross-functional team of 5 developers using Scrum methodology",
    "reason": "Matches job requirement for team leadership and agile experience",
    "category": "leadership_enhancement"
  }
]`;

    const response = await client.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.1,
      max_tokens: 400
    });

    const content = response.choices[0]?.message?.content;
    if (!content) {
      throw new Error('No response from OpenAI');
    }

    try {
      const jsonMatch = content.match(/\[.*\]/s);
      if (jsonMatch) {
        const enhancements = JSON.parse(jsonMatch[0]);
        if (Array.isArray(enhancements)) {
          enhancements.forEach((enhancement, index) => {
            patches.push({
              id: `role_enhance_${index + 1}`,
              type: 'role_enhancement',
              priority: 'high',
              description: `Role-specific enhancement: ${enhancement.category}`,
              details: {
                action: 'enhance_for_role',
                value: enhancement.text,
                reason: enhancement.reason,
                category: enhancement.category,
                impact: 'High impact on job relevance'
              },
              estimatedEffort: 'medium',
              confidence: 0.85
            });
          });
        }
      }
    } catch (parseError) {
      throw new Error(`Failed to parse AI response: ${parseError.message}`);
    }
  } catch (error) {
    logger.warn('Failed to generate role-specific enhancements:', error.message);
  }
  
  return patches;
}

// AI-powered experience alignment with job description
async function generateExperienceAlignmentPatches(currentExperience, jobDescription) {
  const patches = [];
  
  try {
    const { OpenAI } = await import('openai');
    const apiKey = process.env.OPENAI_API_KEY;
    
    if (!apiKey) {
      throw new Error('OpenAI API key not available');
    }
    
    const client = new OpenAI({ apiKey });
    
    const prompt = `You are an expert resume optimization specialist. Analyze the following:

JOB DESCRIPTION:
${jobDescription}

CURRENT RESUME EXPERIENCE:
${currentExperience}

TASK: Generate specific, actionable patches to align the work experience with the job requirements. Focus on:

1. **Technology Alignment**: Suggest specific technologies, tools, or frameworks to mention
2. **Achievement Enhancement**: Suggest measurable outcomes or metrics to add
3. **Role Relevance**: Suggest ways to emphasize experience relevant to the target role
4. **Industry Alignment**: Suggest industry-specific terminology or processes

Generate up to 3 specific patches. For each patch, provide:
- A specific action to take
- The exact text to add/modify
- Why this change improves job alignment

Return ONLY a JSON array of patches, like:
[
  {
    "action": "add_technology_mention",
    "text": "Implemented CI/CD pipelines using Jenkins and Docker",
    "reason": "Directly matches job requirement for DevOps experience"
  },
  {
    "action": "enhance_achievement",
    "text": "Improved system performance by 40% through database optimization",
    "reason": "Demonstrates measurable impact and technical skills"
  }
]`;

    const response = await client.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.1,
      max_tokens: 500
    });

    const content = response.choices[0]?.message?.content;
    if (!content) {
      throw new Error('No response from OpenAI');
    }

    try {
      // Extract JSON array from response
      const jsonMatch = content.match(/\[.*\]/s);
      if (jsonMatch) {
        const alignmentPatches = JSON.parse(jsonMatch[0]);
        if (Array.isArray(alignmentPatches)) {
          alignmentPatches.forEach((patch, index) => {
            patches.push({
              id: `exp_align_${index + 1}`,
              type: 'align_experience',
              priority: 'high',
              description: `Align experience: ${patch.action}`,
              details: {
                action: patch.action,
                value: patch.text,
                reason: patch.reason,
                category: 'experience_alignment',
                impact: 'High impact on job relevance'
              },
              estimatedEffort: 'medium',
              confidence: 0.9
            });
          });
        }
      }
    } catch (parseError) {
      throw new Error(`Failed to parse AI response: ${parseError.message}`);
    }
  } catch (error) {
    logger.warn('Failed to generate experience alignment patches:', error.message);
  }
  
  return patches;
}

// AI-powered keyword filtering
async function aiFilterKeywords(missingKeywords, resumeSections, jobDescription) {
  const { OpenAI } = await import('openai');
  const apiKey = process.env.OPENAI_API_KEY;
  
  if (!apiKey) {
    throw new Error('OpenAI API key not available');
  }
  
  const client = new OpenAI({ apiKey });
  
  const resumeText = Object.values(resumeSections).join(' ');
  const prompt = `You are an expert resume optimization specialist. Analyze the following:

JOB DESCRIPTION:
${jobDescription}

CURRENT RESUME CONTENT:
${resumeText}

MISSING KEYWORDS FROM ANALYSIS:
${missingKeywords.join(', ')}

TASK: Identify the top 5 most valuable and specific technical skills/technologies that should be added to the resume. Focus on:
1. Specific technologies (e.g., "React", "AWS Lambda", "PostgreSQL") not vague terms (e.g., "API", "database", "web development")
2. Skills that directly match the job requirements
3. Technologies that would significantly improve the resume's ATS match score
4. Skills that are NOT already mentioned in the current resume content
5. AVOID generic business terms like "Payment Systems", "Checkout Processes", "Automation", "Financial" - focus on specific technical tools, frameworks, and technologies

Return ONLY a JSON array of the top 5 keywords, like: ["React", "AWS Lambda", "PostgreSQL"]`;

  const response = await client.chat.completions.create({
    model: 'gpt-4o-mini',
    messages: [{ role: 'user', content: prompt }],
    temperature: 0.1,
    max_tokens: 200
  });

  const content = response.choices[0]?.message?.content;
  if (!content) {
    throw new Error('No response from OpenAI');
  }

  try {
    // Extract JSON array from response
    const jsonMatch = content.match(/\[.*\]/);
    if (jsonMatch) {
      const keywords = JSON.parse(jsonMatch[0]);
      return Array.isArray(keywords) ? keywords.slice(0, 5) : [];
    }
    throw new Error('Invalid response format');
  } catch (parseError) {
    throw new Error(`Failed to parse AI response: ${parseError.message}`);
  }
}
