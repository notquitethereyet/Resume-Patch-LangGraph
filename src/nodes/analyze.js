import { logger } from '../utils/logger.js';
import { ProcessingError } from '../utils/error-handler.js';
import OpenAI from 'openai';

export async function analyzeNode(state) {
  logger.info('🔍 Analyzing resume against job description...');
  
  try {
    // Validate required data
    const resumeJson = state.resume?.content?.jsonResume;
    const resumeSections = state.resume?.content?.sections || getResumeSectionsFromJsonResume(resumeJson);
    if (!resumeSections) {
      throw new ProcessingError('Resume content not available for analysis');
    }
    
    if (!state.jobDescription?.content && !state.jobDescription?.sections) {
      throw new ProcessingError('Job description content not available for analysis');
    }
    
    // Extract key information
    // resumeSections prepared above
    const jobSections = state.jobDescription.sections || {};
    const jobContent = state.jobDescription.content || '';

    // Extract prioritized keywords with OpenAI for BOTH JD and Resume
    let aiJobKeywords = [];
    let aiResumeKeywords = [];
    try {
      aiJobKeywords = await aiExtractKeywords(jobContent);
    } catch (e) {
      logger.warn('OpenAI keyword extraction for JD failed', { error: e.message });
      aiJobKeywords = [];
    }

    const resumeTextAll = Object.values(resumeSections).join(' ');
    try {
      aiResumeKeywords = await aiExtractKeywords(resumeTextAll);
    } catch (e) {
      logger.warn('OpenAI keyword extraction for Resume failed', { error: e.message });
      aiResumeKeywords = [];
    }
    
    // Perform analysis
    const analysis = {
      matchScore: calculateAIMatchScore(aiResumeKeywords, aiJobKeywords),
      keywordAnalysis: analyzeKeywords(aiResumeKeywords, aiJobKeywords),
      skillGaps: identifySkillGapsFromAI(aiResumeKeywords, aiJobKeywords),
      experienceMatch: analyzeExperienceMatch(resumeSections, jobSections),
      recommendations: generateRecommendationsFromAI(resumeSections, identifySkillGapsFromAI(aiResumeKeywords, aiJobKeywords), aiJobKeywords),
      analyzedAt: new Date().toISOString()
    };
    
    logger.info('Analysis completed successfully', { 
      matchScore: analysis.matchScore,
      skillGapsCount: analysis.skillGaps.length,
      recommendationsCount: analysis.recommendations.length
    });
    
    return {
      ...state,
      analysis
    };
  } catch (error) {
    logger.error('Analysis failed', { error: error.message });
    throw new ProcessingError(`Analysis failed: ${error.message}`, { 
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

function calculateMatchScore(resumeSections, jobSections, jobContent) {
  let totalScore = 0;
  let maxScore = 0;
  
  // Skills matching (40% of total score)
  const skillsScore = calculateSkillsScore(resumeSections.skills || '', jobSections.skills || '', jobContent);
  totalScore += skillsScore * 0.4;
  maxScore += 0.4;
  
  // Experience matching (30% of total score)
  const experienceScore = calculateExperienceScore(resumeSections.experience || '', jobSections.experience || '', jobContent);
  totalScore += experienceScore * 0.3;
  maxScore += 0.3;
  
  // Education matching (20% of total score)
  const educationScore = calculateEducationScore(resumeSections.education || '', jobSections.requirements || '', jobContent);
  totalScore += educationScore * 0.2;
  maxScore += 0.2;
  
  // Overall content relevance (10% of total score)
  const contentScore = calculateContentRelevance(resumeSections, jobContent);
  totalScore += contentScore * 0.1;
  maxScore += 0.1;
  
  return Math.round((totalScore / maxScore) * 100) / 100;
}

function calculateAIMatchScore(aiResumeKeywords, aiJobKeywords) {
  const resume = new Set(normalizeAIKeywords(aiResumeKeywords).map(s => s.toLowerCase()));
  const job = normalizeAIKeywords(aiJobKeywords).map(s => s.toLowerCase());
  if (job.length === 0) return 0;
  const matched = job.filter(k => resume.has(k)).length;
  return Math.round((matched / job.length) * 100) / 100;
}

function calculateSkillsScore(resumeSkills, jobSkills, jobContent) {
  if (!resumeSkills || !jobContent) return 0;
  
  const resumeSkillList = extractSkills(resumeSkills);
  const jobSkillList = extractSkills(jobSkills || jobContent);
  
  if (jobSkillList.length === 0) return 0;
  
  const matchedSkills = resumeSkillList.filter(skill => 
    jobSkillList.some(jobSkill => 
      skill.toLowerCase().includes(jobSkill.toLowerCase()) ||
      jobSkill.toLowerCase().includes(skill.toLowerCase())
    )
  );
  
  return matchedSkills.length / jobSkillList.length;
}

function calculateExperienceScore(resumeExperience, jobExperience, jobContent) {
  if (!resumeExperience || !jobContent) return 0;
  
  // Extract years of experience from both
  const resumeYears = extractYearsOfExperience(resumeExperience);
  const jobYears = extractYearsOfExperience(jobExperience || jobContent);
  
  if (jobYears === 0) return 0;
  
  if (resumeYears >= jobYears) return 1;
  return Math.max(0, resumeYears / jobYears);
}

function calculateEducationScore(resumeEducation, jobRequirements, jobContent) {
  if (!resumeEducation || !jobContent) return 0;
  
  const educationLevels = ['phd', 'masters', 'bachelors', 'associate', 'high school'];
  const resumeLevel = getEducationLevel(resumeEducation);
  const jobLevel = getEducationLevel(jobRequirements || jobContent);
  
  if (!resumeLevel || !jobLevel) return 0.5; // Default to middle score if unclear
  
  const resumeIndex = educationLevels.indexOf(resumeLevel);
  const jobIndex = educationLevels.indexOf(jobLevel);
  
  if (resumeIndex <= jobIndex) return 1; // Resume meets or exceeds requirements
  return Math.max(0, (educationLevels.length - resumeIndex) / (educationLevels.length - jobIndex));
}

function calculateContentRelevance(resumeSections, jobContent) {
  if (!jobContent) return 0;
  
  const resumeText = Object.values(resumeSections).join(' ').toLowerCase();
  const jobText = jobContent.toLowerCase();
  
  // Simple keyword matching
  const jobWords = jobText.split(/\s+/).filter(word => word.length > 3);
  const matchedWords = jobWords.filter(word => resumeText.includes(word));
  
  return jobWords.length > 0 ? matchedWords.length / jobWords.length : 0;
}

function extractSkills(text) {
  const skillPatterns = [
    /(?:skills?|technologies?|tools?|languages?|frameworks?)[:\s]+([^.\n]+)/gi,
    /(?:proficient in|experience with|knowledge of)[:\s]+([^.\n]+)/gi
  ];
  
  const skills = [];
  skillPatterns.forEach(pattern => {
    let match;
    while ((match = pattern.exec(text)) !== null) {
      const skillText = match[1].trim();
      skills.push(...skillText.split(/[,;&]/).map(s => s.trim()).filter(s => s.length > 0));
    }
  });
  
  return [...new Set(skills)];
}

function extractYearsOfExperience(text) {
  const patterns = [
    /(\d+)\s*(?:years?|yrs?)\s*(?:of\s+)?(?:experience|exp)/i,
    /experience[:\s]+([^.\n]+)/i
  ];
  
  for (const pattern of patterns) {
    const match = pattern.exec(text);
    if (match) {
      const years = parseInt(match[1]);
      if (!isNaN(years)) return years;
    }
  }
  
  return 0;
}

function getEducationLevel(text) {
  const lowerText = text.toLowerCase();
  
  if (lowerText.includes('phd') || lowerText.includes('doctorate')) return 'phd';
  if (lowerText.includes('masters') || lowerText.includes('ms') || lowerText.includes('ma')) return 'masters';
  if (lowerText.includes('bachelors') || lowerText.includes('bs') || lowerText.includes('ba')) return 'bachelors';
  if (lowerText.includes('associate') || lowerText.includes('aa')) return 'associate';
  if (lowerText.includes('high school') || lowerText.includes('diploma')) return 'high school';
  
  return null;
}

function identifySkillGapsFromAI(aiResumeKeywords, aiJobKeywords) {
  const resume = new Set(normalizeAIKeywords(aiResumeKeywords).map(s => s.toLowerCase()));
  const job = normalizeAIKeywords(aiJobKeywords).map(s => s.toLowerCase());
  return job.filter(k => !resume.has(k));
}

function analyzeKeywords(aiResumeKeywords, aiJobKeywords) {
  const resumeKeywords = normalizeAIKeywords(aiResumeKeywords);
  const jobKeywords = normalizeAIKeywords(aiJobKeywords);
  return {
    resume: resumeKeywords,
    job: jobKeywords,
    common: resumeKeywords.filter(k => jobKeywords.includes(k)),
    missing: jobKeywords.filter(k => !resumeKeywords.includes(k))
  };
}

function normalizeAIKeywords(list) {
  const arr = Array.isArray(list)
    ? (typeof list[0] === 'string' ? list : list.map(k => k.phrase || ''))
    : [];
  return [...new Set(arr.map(s => s.trim()).filter(Boolean))].slice(0, 20);
}

function normalizePhrases(text) {
  return text
    .split(/[,;]/)
    .map(s => s.trim())
    .filter(Boolean)
    .slice(0, 20);
}

async function aiExtractKeywords(jobText) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error('OPENAI_API_KEY is not set');
  if (!jobText || jobText.trim().length === 0) return [];

  const client = new OpenAI({ apiKey });
  const system = `You are a recruiting assistant for technical roles. Extract concise, high-signal technical keywords and multi-word phrases from a job description.
 Rules:
 - Focus on technologies, frameworks, languages, cloud/services, data stores, methodologies, and seniority signals.
 - Preserve multi-word tech names as a single phrase (e.g., "Ruby on Rails", "Next.js", "PostgreSQL", "CI/CD").
 - Normalize casing (e.g., "Next.js", "Node.js").
 - Prefer canonical names over variants (e.g., "PostgreSQL" not "Postgres" unless JD uses it).
 - Group synonyms in clusters; pick the canonical phrase as the representative.
 - Return 10–20 items, prioritized by importance.
- EXCLUDE vague role labels, soft skills, and generic terms (e.g., "full stack developer", "self-starter", "building", "learning", "interest").
- EXCLUDE non-technical business terms (e.g., "product", "team", "culture", "communication").
- ONLY include concrete technical stack items, tools, languages, frameworks, and methodologies.
- If a term could apply to any job, it's too generic - exclude it.
 - Output strict JSON with shape: { "keywords": [ {"phrase": string, "weight": number (0-1), "cluster": string } ] }`;

  const user = `Job Description:\n\n${jobText.substring(0, 12000)}\n\nReturn only JSON as specified.`;

  const resp = await client.chat.completions.create({
    model: process.env.OPENAI_MODEL,
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user }
    ],
    response_format: { type: 'json_object' }
  });

  const content = resp.choices?.[0]?.message?.content;
  if (!content) throw new Error('No content from OpenAI');
  let parsed;
  try { parsed = JSON.parse(content); } catch { throw new Error('OpenAI keywords JSON parse failed'); }
  const list = Array.isArray(parsed?.keywords) ? parsed.keywords : [];
  // Map to unified format
  return list
    .map(k => ({ phrase: (k.phrase || '').toString().trim(), weight: Number(k.weight ?? 0.5), cluster: (k.cluster || '').toString().trim() }))
    .filter(k => k.phrase.length > 0)
    .slice(0, 20);
}

function analyzeExperienceMatch(resumeSections, jobSections) {
  const resumeExp = resumeSections.experience || '';
  const jobExp = jobSections.experience || '';
  
  if (!resumeExp || !jobExp) return { match: false, reason: 'Missing experience data' };
  
  const resumeYears = extractYearsOfExperience(resumeExp);
  const jobYears = extractYearsOfExperience(jobExp);
  
  if (resumeYears >= jobYears) {
    return { match: true, reason: 'Experience requirements met' };
  } else {
    return { match: false, reason: `Need ${jobYears - resumeYears} more years of experience` };
  }
}

function generateRecommendationsFromAI(resumeSections, skillGaps, aiJobKeywords) {
  const recommendations = [];
  if (skillGaps.length > 0) {
    recommendations.push({
      type: 'add_skills',
      priority: 'high',
      description: `Add missing skills: ${skillGaps.slice(0, 5).join(', ')}`,
      impact: 'High impact on match score'
    });
  }
  // Simple heuristic for content expansion
  if ((resumeSections.skills || '').length < 100) {
    recommendations.push({
      type: 'expand_skills',
      priority: 'low',
      description: 'Expand skills section with specific tech and tools matching JD',
      impact: 'Low impact on match score'
    });
  }
  return recommendations;
}
