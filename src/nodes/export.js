import { logger } from '../utils/logger.js';
import { ProcessingError } from '../utils/error-handler.js';
import { createTempDir, cleanupTempFiles } from '../utils/file-utils.js';
import fs from 'fs/promises';
import path from 'node:path';
import { exec } from 'child_process';
import { promisify } from 'node:util';

const execAsync = promisify(exec);

export async function exportNode(state) {
  logger.info('📤 Exporting optimized resume...');
  
  try {
    // Validate required data
    if (!state.resume?.patched) {
      throw new ProcessingError('Resume has not been patched yet');
    }
    
    if (!state.resume?.content?.sections && !state.resume?.content?.jsonResume) {
      throw new ProcessingError('Resume content not available for export');
    }
    
    // Create temporary directory for processing
    const tempDir = await createTempDir();
    
    // Generate export formats
    const exportResults = await generateExports(state.resume, tempDir);

    // Optionally write outputs to disk if allowed
    let outputFiles = {};
    const allowDisk = Boolean(state.allow_disk);
    const outDir = state.output_path || 'optimized-resume';
    if (allowDisk) {
      await fs.mkdir(outDir, { recursive: true });
      if (exportResults.json?.content) {
        const p = path.join(outDir, 'resume.json');
        await fs.writeFile(p, JSON.stringify(exportResults.json.content, null, 2), 'utf8');
        outputFiles.json = p;
      }
      if (exportResults.text?.content) {
        const p = path.join(outDir, 'summary.txt');
        await fs.writeFile(p, exportResults.text.content, 'utf8');
        outputFiles.text = p;
      }
      if (exportResults.patchReport?.content) {
        const p = path.join(outDir, 'patchReport.md');
        await fs.writeFile(p, exportResults.patchReport.content, 'utf8');
        outputFiles.patchReport = p;
      }
      if (exportResults.pdf?.success && exportResults.pdf?.filePath) {
        try {
          const pdfName = path.basename(exportResults.pdf.filePath);
          const pdfDest = path.join(outDir, pdfName);
          await fs.copyFile(exportResults.pdf.filePath, pdfDest);
          outputFiles.pdf = pdfDest;
        } catch (e) {
          logger.warn('Skipping PDF copy; source missing', { error: e.message });
        }
      }
      if (exportResults.html?.success && exportResults.html?.filePath) {
        try {
          const htmlName = path.basename(exportResults.html.filePath);
          const htmlDest = path.join(outDir, htmlName);
          await fs.copyFile(exportResults.html.filePath, htmlDest);
          outputFiles.html = htmlDest;
        } catch (e) {
          logger.warn('Skipping HTML copy; source missing', { error: e.message });
        }
      }
    }
    
    // Clean up temp files
    await cleanupTempFiles();
    
    logger.info('Export completed successfully', { 
      formats: Object.keys(exportResults),
      outputPath: outDir,
      wroteFiles: Object.keys(outputFiles)
    });
    
    return {
      ...state,
      output: {
        path: outDir,
        formats: exportResults,
        files: outputFiles,
        exportedAt: new Date().toISOString(),
        success: true
      }
    };
  } catch (error) {
    logger.error('Export failed', { error: error.message });
    
    // Clean up temp files on error
    try {
      await cleanupTempFiles();
    } catch (cleanupError) {
      logger.warn('Failed to cleanup temp files', { error: cleanupError.message });
    }
    
    throw new ProcessingError(`Export failed: ${error.message}`, { 
      originalError: error.message 
    });
  }
}

async function generateExports(resume, tempDir) {
  const exports = {};
  
  try {
    // Generate JSON Resume format
    const jsonResume = generateJSONResume(resume);
    exports.json = {
      content: jsonResume,
      format: 'json-resume',
      size: JSON.stringify(jsonResume).length
    };
    
    // Generate text summary
    const textSummary = generateTextSummary(resume);
    exports.text = {
      content: textSummary,
      format: 'text',
      size: textSummary.length
    };
    
    // Generate patch report
    const patchReport = generatePatchReport(resume);
    exports.patchReport = {
      content: patchReport,
      format: 'markdown',
      size: patchReport.length
    };

    // Write JSON to temp file for Resumed
    const tmpJsonPath = path.join(tempDir, 'resume.json');
    await fs.writeFile(tmpJsonPath, JSON.stringify(jsonResume, null, 2), 'utf8');

    // Always use straightforward theme per project requirement
    const theme = 'jsonresume-theme-straightforward';

    // Generate HTML via Resumed
    try {
      const htmlOut = path.join(tempDir, 'resume.html');
      const themeArg = ` -t ${JSON.stringify(theme)}`;
      await execAsync(`npx -y resumed render ${JSON.stringify(tmpJsonPath)}${themeArg} -o ${JSON.stringify(htmlOut)} | cat`);
      let htmlContent = null;
      try { htmlContent = await fs.readFile(htmlOut, 'utf8'); } catch {}
      if (htmlContent) {
        exports.html = {
          content: htmlContent,
          format: 'html',
          filePath: htmlOut,
          size: htmlContent.length,
          success: true
        };
      } else {
        exports.html = { content: null, format: 'html', filePath: null, success: false, error: 'HTML file not created' };
      }
    } catch (e) {
      logger.warn('HTML generation via Resumed failed', { error: e.message });
      exports.html = { content: null, format: 'html', filePath: null, success: false, error: e.message };
    }

    // Generate PDF via Resumed
    try {
      const pdfOut = path.join(tempDir, 'resume.pdf');
      const themeArg = ` -t ${JSON.stringify(theme)}`;
      await execAsync(`npx -y resumed export ${JSON.stringify(tmpJsonPath)}${themeArg} -o ${JSON.stringify(pdfOut)} | cat`);
      let exists = false;
      try { await fs.access(pdfOut); exists = true; } catch {}
      exports.pdf = exists
        ? { content: null, format: 'pdf', filePath: pdfOut, success: true }
        : { content: null, format: 'pdf', filePath: null, success: false, error: 'PDF file not created' };
    } catch (e) {
      logger.warn('PDF generation via Resumed failed', { error: e.message });
      exports.pdf = { content: null, format: 'pdf', filePath: null, success: false, error: e.message };
    }
    
  } catch (error) {
    logger.error('Error generating exports', { error: error.message });
    throw error;
  }
  
  return exports;
}

function generateJSONResume(resume) {
  // If we have a structured JSON Resume from parsing, prefer it to avoid data loss
  const parsedJson = resume?.content?.jsonResume;
  const meta = {
    patched: resume.patched,
    patchedAt: resume.patchedAt,
    appliedPatches: resume.appliedPatches?.length || 0,
    originalSections: Object.keys(resume.content.originalSections || {}),
    patchedSections: Object.keys(resume.content.sections || {})
  };

  if (parsedJson && typeof parsedJson === 'object') {
    // Try to group skills using BOTH original and patched skills text to preserve and augment content
    const skillsTextSources = [
      resume?.content?.originalSections?.skills,
      resume?.content?.sections?.skills
    ].filter(Boolean);
    const combinedSkillsText = skillsTextSources.join('\n').trim();
    const groupedFromText = extractGroupedSkills(combinedSkillsText);
    let skills = parsedJson.skills;
    if (groupedFromText.length > 0) {
      skills = groupedFromText;
    } else if (Array.isArray(parsedJson.skills) && parsedJson.skills.length > 0) {
      // If parser produced flat items (e.g., [{ name: 'Python' }]), condense into a single group
      const flatNames = parsedJson.skills
        .map(s => (typeof s === 'string' ? s : (s?.name || '')))
        .map(s => s && String(s).trim())
        .filter(Boolean);
      if (flatNames.length > 0) {
        const grouped = groupSkillsByHeuristics(Array.from(new Set(flatNames)));
        skills = grouped.length > 0 ? grouped : [{ name: 'Skills', keywords: Array.from(new Set(flatNames)) }];
      }
    }

    // Ensure skills groups exist with keywords; rebuild from text if missing
    if (!Array.isArray(skills) || skills.length === 0 || skills.every(g => !Array.isArray(g.keywords) || g.keywords.length === 0)) {
      const rebuilt = extractGroupedSkills(combinedSkillsText);
      if (rebuilt.length > 0) {
        skills = rebuilt;
      }
    }

    // If skills still look like high-level buckets (no concrete tech), extract from work/projects text
    const looksLikeCategoryLabel = (s) => /(&|Development|Engineering|Practices|Data|DevOps)/i.test(String(s || ''));
    const isSingleGroupOfCategories = Array.isArray(skills)
      && skills.length === 1
      && Array.isArray(skills[0].keywords)
      && skills[0].keywords.some(looksLikeCategoryLabel);

    if (!hasConcreteTech(skills) || isSingleGroupOfCategories) {
      const techFromContent = extractTechFromContent({
        work: Array.isArray(parsedJson.work) ? parsedJson.work : [],
        projects: Array.isArray(parsedJson.projects) ? parsedJson.projects : []
      });
      const grouped = groupSkillsByHeuristics(techFromContent);
      if (grouped.length > 0) skills = grouped;
    }

    // Ensure each group has at least 5 keywords by supplementing from mined tech without removing aligned items
    const supplementPool = extractTechFromContent({
      work: Array.isArray(parsedJson.work) ? parsedJson.work : [],
      projects: Array.isArray(parsedJson.projects) ? parsedJson.projects : []
    });
    skills = normalizeAndEnsureSkills(skills, supplementPool, 5);

    // Normalize dates in work to JSON Resume format (YYYY-MM) and drop 'Present'
    let work = Array.isArray(parsedJson.work) ? normalizeWorkDates(parsedJson.work) : [];
    work = work.map(w => ({
      // Themes often expect 'name' for employer; map from company when missing
      name: w.name || w.company || w.employer || undefined,
      company: w.company,
      position: w.position,
      location: w.location,
      description: w.description,
      url: w.url,
      startDate: w.startDate,
      endDate: w.endDate,
      summary: w.summary,
      highlights: sanitizeHighlights(w.highlights)
    }));

    // Enrich basics from header if missing fields
    const headerText = resume?.content?.sections?.header || '';
    const basics = ensureWebsiteAndGithub(normalizeBasicsLocation(enrichBasics(parsedJson.basics || {}, headerText)));

    // Normalize projects: clean punctuation and expand highlights when missing
    const projects = normalizeProjects(parsedJson.projects, resume?.content?.sections?.projects || '');

    return {
      ...parsedJson,
      basics,
      work,
      skills,
      projects,
      meta: { ...(parsedJson.meta || {}), ...meta }
    };
  }

  const sections = resume.content.sections || {};

  return {
    basics: ensureWebsiteAndGithub(normalizeBasicsLocation({
      name: extractName(sections.header || ''),
      email: extractEmail(sections.header || ''),
      phone: extractPhone(sections.header || ''),
      location: extractLocation(sections.header || ''),
      summary: sections.header || ''
    })),
    work: parseWorkExperience(sections.experience || ''),
    education: parseEducation(sections.education || ''),
    skills: (() => {
      const grouped = extractGroupedSkills(sections.skills || '');
      if (grouped.length > 0 && hasConcreteTech(grouped)) return grouped;
      // fallback: mine tech from experience/projects text
      const mined = extractTechFromContent({
        work: parseWorkExperience(sections.experience || ''),
        projects: parseProjects(sections.projects || '')
      });
      const groupedMined = groupSkillsByHeuristics(mined);
      return groupedMined.length > 0 ? groupedMined : grouped;
    })(),
    projects: parseProjects(sections.projects || ''),
    meta
  };
}

function generateTextSummary(resume) {
  const sections = resume.content.sections;
  let summary = 'OPTIMIZED RESUME SUMMARY\n';
  summary += '='.repeat(50) + '\n\n';
  
  // Header
  if (sections.header) {
    summary += 'HEADER:\n';
    summary += sections.header + '\n\n';
  }
  
  // Skills
  if (sections.skills) {
    summary += 'SKILLS:\n';
    summary += sections.skills + '\n\n';
  }
  
  // Experience
  if (sections.experience) {
    summary += 'EXPERIENCE:\n';
    summary += sections.experience + '\n\n';
  }
  
  // Education
  if (sections.education) {
    summary += 'EDUCATION:\n';
    summary += sections.education + '\n\n';
  }
  
  // Projects
  if (sections.projects) {
    summary += 'PROJECTS:\n';
    summary += sections.projects + '\n\n';
  }
  
  // Patch information
  if (resume.appliedPatches && resume.appliedPatches.length > 0) {
    summary += 'APPLIED PATCHES:\n';
    summary += '='.repeat(30) + '\n';
    resume.appliedPatches.forEach((patch, index) => {
      summary += `${index + 1}. ${patch.description}\n`;
      summary += `   Type: ${patch.type}, Priority: ${patch.priority}\n`;
      summary += `   Applied: ${patch.appliedAt}\n\n`;
    });
  }
  
  return summary;
}

function generatePatchReport(resume) {
  let report = '# Resume Optimization Report\n\n';
  report += `**Generated:** ${new Date().toLocaleString()}\n`;
  report += `**Original Resume:** ${resume.path}\n\n`;
  
  // Summary
  report += '## Summary\n\n';
  report += `- **Total Patches Applied:** ${resume.appliedPatches?.length || 0}\n`;
  report += `- **Patches Failed:** ${resume.failedPatches?.length || 0}\n`;
  report += `- **Optimization Date:** ${resume.patchedAt}\n\n`;
  
  // Applied Patches
  if (resume.appliedPatches && resume.appliedPatches.length > 0) {
    report += '## Applied Patches\n\n';
    resume.appliedPatches.forEach((patch, index) => {
      report += `### ${index + 1}. ${patch.description}\n\n`;
      report += `- **Type:** ${patch.type}\n`;
      report += `- **Priority:** ${patch.priority}\n`;
      report += `- **Impact:** ${patch.details?.impact || 'Unknown'}\n`;
      report += `- **Applied:** ${patch.appliedAt}\n\n`;
      
      if (patch.result?.changes) {
        report += '**Changes Made:**\n';
        Object.entries(patch.result.changes).forEach(([key, value]) => {
          report += `- ${key}: ${value}\n`;
        });
        report += '\n';
      }
    });
  }
  
  // Failed Patches
  if (resume.failedPatches && resume.failedPatches.length > 0) {
    report += '## Failed Patches\n\n';
    resume.failedPatches.forEach((patch, index) => {
      report += `### ${index + 1}. ${patch.description}\n\n`;
      report += `- **Type:** ${patch.type}\n`;
      report += `- **Reason:** ${patch.reason}\n`;
      report += `- **Failed:** ${patch.failedAt}\n\n`;
    });
  }
  
  // Recommendations
  report += '## Next Steps\n\n';
  report += '1. Review the applied patches for accuracy\n';
  report += '2. Customize the resume further based on specific job requirements\n';
  report += '3. Consider additional optimizations based on failed patches\n';
  report += '4. Export to PDF/HTML using the JSON Resume CLI when available\n\n';
  
  return report;
}

// Helper functions for parsing resume sections
function extractName(text) {
  // Simple name extraction - first line is usually the name
  const lines = text.split('\n').filter(line => line.trim().length > 0);
  return lines[0] || 'Name Not Found';
}

function extractEmail(text) {
  const emailMatch = text.match(/[\w.-]+@[\w.-]+\.\w+/);
  return emailMatch ? emailMatch[0] : 'email@example.com';
}

function extractPhone(text) {
  const phoneMatch = text.match(/[\+]?[\d\s\-\(\)]{10,}/);
  return phoneMatch ? phoneMatch[0] : 'Phone Not Found';
}

function extractLocation(text) {
  const locationMatch = text.match(/(?:location|address)[:\s]+([^\n]+)/i);
  return locationMatch ? locationMatch[1].trim() : 'Location Not Found';
}

function parseWorkExperience(text) {
  if (!text) return [];
  
  const lines = text.split('\n').filter(line => line.trim().length > 0);
  const experiences = [];
  let currentExp = { company: '', position: '', startDate: '', endDate: '', summary: '' };
  
  lines.forEach(line => {
    if (line.includes(' - ') || line.includes(' at ')) {
      // New experience entry
      if (currentExp.company) {
        experiences.push({ ...currentExp });
      }
      currentExp = { company: '', position: '', startDate: '', endDate: '', summary: '' };
      
      const parts = line.split(/ - | at /);
      if (parts.length >= 2) {
        currentExp.position = parts[0].trim();
        currentExp.company = parts[1].trim();
      }
    } else {
      currentExp.summary += (currentExp.summary ? ' ' : '') + line.trim();
    }
  });
  
  if (currentExp.company) {
    experiences.push(currentExp);
  }
  
  return experiences;
}

function parseEducation(text) {
  if (!text) return [];
  
  const lines = text.split('\n').filter(line => line.trim().length > 0);
  const education = [];
  
  lines.forEach(line => {
    if (line.includes('University') || line.includes('College') || line.includes('School')) {
      education.push({
        institution: line.trim(),
        area: 'Degree Not Specified',
        studyType: 'Bachelor'
      });
    }
  });
  
  return education;
}

function parseSkills(text) {
  if (!text) return [];
  
  const skills = text.split(/[,;&]/).map(skill => skill.trim()).filter(skill => skill.length > 0);
  
  return skills.map(skill => ({
    name: skill,
    level: 'Intermediate'
  }));
}

function parseProjects(text) {
  if (!text) return [];
  
  const lines = text.split('\n').filter(line => line.trim().length > 0);
  const projects = [];
  
  lines.forEach(line => {
    if (line.includes('Project') || line.includes('Developed') || line.includes('Built')) {
      projects.push({
        name: line.trim(),
        description: line.trim(),
        highlights: [line.trim()]
      });
    }
  });
  
  return projects;
}

// Group skills by category lines like:
// "• Backend Development & Infrastructure: Python, FastAPI, Flask, ..."
// Produces JSON Resume shape: [{ name: category, keywords: [skill, ...] }]
function extractGroupedSkills(text) {
  if (!text) return [];

  const lines = text
    .split('\n')
    .map(l => l.replace(/^[-•\u2022\u25CF\u25E6\u2023]\s*/, '').trim())
    .filter(l => l.length > 0);

  const groups = [];
  const seenCategory = new Set();

  lines.forEach(line => {
    const m = line.match(/^(.*?):\s*(.*)$/);
    if (m) {
      const category = m[1].trim();
      const rest = m[2].trim();
      const items = rest
        .split(/[,;/]\s*/)
        .map(s => s.replace(/\s*\([^\)]*\)\s*$/, '').trim())
        .filter(Boolean);
      const deduped = Array.from(new Set(items));
      if (category && deduped.length > 0) {
        groups.push({ name: category, keywords: deduped });
        seenCategory.add(category.toLowerCase());
      }
    }
  });

  // If no explicit categories found, try to flatten as a single group
  if (groups.length === 0) {
    const flat = text
      .split(/[,;\n]/)
      .map(s => s.replace(/^[-•\u2022\u25CF\u25E6\u2023]\s*/, '').trim())
      .filter(Boolean);
    const deduped = Array.from(new Set(flat));
    if (deduped.length > 0) {
      return [{ name: 'Skills', keywords: deduped }];
    }
  }

  return groups;
}

function groupSkillsByHeuristics(keywords) {
  const buckets = {
    'Backend Development & Infrastructure': new Set(),
    'Frontend Development & UI Engineering': new Set(),
    'Machine Learning & Data Engineering': new Set(),
    'Cloud & DevOps': new Set(),
    'Datastores': new Set(),
    'Practices & Methodologies': new Set()
  };

  const lower = (s) => s.toLowerCase();

  const isBackend = (k) => /^(python|fastapi|flask|node\.js|express\.js|rest|api|graphql)$/i.test(k) || ['redis'].includes(lower(k));
  const isFrontend = (k) => /^(javascript|typescript|react|react\.js|angular|tailwind|html|css|wcag)/i.test(k);
  const isML = (k) => /^(pytorch|tensorflow|scikit|scikit-learn|numpy|pandas|langchain|llm|rAG|vector|embedding|data visualization|statistical analysis)$/i.test(k);
  const isCloud = (k) => /^(docker|kubernetes|gcp|google cloud|aws|azure|ci\/cd|git)$/i.test(k);
  const isDB = (k) => /^(postgres|postgresql|mongodb|mysql|redis)$/i.test(k);
  const isPractice = (k) => /^(agile|oop|object-oriented|tdd|test-driven|system architecture|performance optimization|secure coding)/i.test(k);

  keywords.forEach(k => {
    const key = String(k).trim();
    if (!key) return;
    if (isBackend(key)) return buckets['Backend Development & Infrastructure'].add(k);
    if (isFrontend(key)) return buckets['Frontend Development & UI Engineering'].add(k);
    if (isML(key)) return buckets['Machine Learning & Data Engineering'].add(k);
    if (isCloud(key)) return buckets['Cloud & DevOps'].add(k);
    if (isDB(key)) return buckets['Datastores'].add(k);
    if (isPractice(key)) return buckets['Practices & Methodologies'].add(k);
    // Fallback: put into Backend by default to avoid dropping skills
    buckets['Backend Development & Infrastructure'].add(k);
  });

  return Object.entries(buckets)
    .map(([name, set]) => ({ name, keywords: Array.from(set) }))
    .filter(group => group.keywords.length > 0);
}

function normalizeWorkDates(work) {
  const monthMap = {
    jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06',
    jul: '07', aug: '08', sep: '09', sept: '09', oct: '10', nov: '11', dec: '12'
  };
  const toIso = (s) => {
    if (!s) return undefined;
    const str = String(s).trim();
    if (!str || /^present$/i.test(str)) return undefined;
    const m = str.match(/^(\w{3,})\s+(\d{4})$/);
    if (m) {
      const mm = monthMap[m[1].slice(0,3).toLowerCase()] || '01';
      return `${m[2]}-${mm}`;
    }
    const y = str.match(/^(\d{4})([-/](\d{1,2}))?$/);
    if (y) {
      const mm = y[3] ? String(y[3]).padStart(2, '0') : '01';
      return `${y[1]}-${mm}`;
    }
    return str; // leave as-is if unrecognized
  };

  return work.map(w => {
    const start = toIso(w.startDate);
    const end = toIso(w.endDate);
    const out = { ...w };
    if (start) out.startDate = start;
    if (end) out.endDate = end; else delete out.endDate;
    return out;
  });
}

function enrichBasics(basics, headerText) {
  const out = { ...basics };
  if (!out.email) out.email = extractEmail(headerText) || out.email;
  if (!out.phone) out.phone = extractPhone(headerText) || out.phone;
  if (!out.location || !out.location.address) {
    const addr = extractLocation(headerText);
    if (addr && addr !== 'Location Not Found') {
      out.location = out.location || {};
      out.location.address = addr;
    }
  }

  const profiles = extractProfiles(headerText);
  if (profiles.length > 0) {
    out.profiles = Array.isArray(out.profiles) ? dedupeProfiles(out.profiles.concat(profiles)) : profiles;
  }
  return out;
}

function extractProfiles(text) {
  if (!text) return [];
  const results = [];
  const add = (network, url) => results.push({ network, url });
  const urls = text.match(/https?:\/\/[\w.-]+\.[\w.-/#?=&_%~+-]+/g) || [];
  urls.forEach(u => {
    const ul = u.toLowerCase();
    if (ul.includes('github.com')) add('GitHub', u);
    else if (ul.includes('linkedin.com')) add('LinkedIn', u);
    else add('Website', u);
  });
  return results;
}

function dedupeProfiles(profiles) {
  const seen = new Set();
  const out = [];
  profiles.forEach(p => {
    const key = `${(p.network||'').toLowerCase()}|${(p.url||'').toLowerCase()}`;
    if (!seen.has(key)) {
      seen.add(key);
      out.push(p);
    }
  });
  return out;
}

function normalizeProjects(projects, projectsText) {
  const cleanText = (s) => String(s || '')
    .replace(/\.{2,}/g, '.')
    .replace(/\s+\./g, '.')
    .trim();

  const result = Array.isArray(projects) ? projects.map(p => ({ ...p })) : [];

  result.forEach(p => {
    p.description = cleanText(p.description || p.summary || '');
    if (!Array.isArray(p.highlights)) p.highlights = [];
    p.highlights = p.highlights.map(h => cleanText(h)).filter(Boolean);

    // If no highlights, derive from description sentences
    if (p.highlights.length === 0 && p.description) {
      const sentences = p.description.split(/(?<=\.)\s+/).map(s => cleanText(s)).filter(Boolean);
      if (sentences.length > 1) {
        p.description = cleanText(sentences.shift());
        p.highlights = sentences.slice(0, 4);
      }
    }
  });

  // If still empty, try to extract bullets from raw section text
  if (result.length === 0 && projectsText) {
    const lines = projectsText.split('\n').map(l => l.trim());
    const bullets = lines.filter(l => /^[•\-]/.test(l)).map(l => l.replace(/^[•\-]\s*/, ''));
    if (bullets.length > 0) {
      return [{ name: 'Projects', description: '', highlights: bullets.slice(0, 6).map(cleanText) }];
    }
  }

  return result;
}

// Remove leading bullets/hyphens and excess whitespace from highlights to avoid double bullets in themes
function sanitizeHighlights(highlights) {
  if (!Array.isArray(highlights)) return highlights;
  return highlights
    .map(h => String(h || ''))
    .map(h => h.replace(/^[\s•\-\u2022\u25CF\u25E6\u2023]+/, '').trim())
    .filter(Boolean);
}

// Dedupe keywords within and across groups; keep first occurrence globally, then ensure minimum per group without reintroducing duplicates
function normalizeAndEnsureSkills(groups, supplementPool, min = 5) {
  const pool = Array.isArray(supplementPool) ? Array.from(new Set(supplementPool.map(String))) : [];

  // Pre-clean within groups (trim, strip trailing punctuation, dedupe case-insensitively)
  const cleaned = (Array.isArray(groups) ? groups : []).map(g => {
    const set = new Set();
    const keywords = Array.isArray(g.keywords) ? g.keywords : [];
    const cleanedKw = keywords
      .map(k => String(k || '').trim().replace(/[.,;]+$/, ''))
      .filter(Boolean)
      .filter(k => {
        const lk = k.toLowerCase();
        if (set.has(lk)) return false;
        set.add(lk);
        return true;
      });
    return { ...g, keywords: cleanedKw };
  });

  // Global dedupe: keep first group occurrence for each keyword
  const seen = new Set();
  cleaned.forEach(g => {
    g.keywords = g.keywords.filter(k => {
      const lk = k.toLowerCase();
      if (seen.has(lk)) return false;
      seen.add(lk);
      return true;
    });
  });

  // Ensure minimum per group using pool without introducing duplicates
  const addIfPossible = (existing, globalSeen) => {
    const out = Array.isArray(existing) ? [...existing] : [];
    const local = new Set(out.map(x => String(x).toLowerCase()));
    for (const k of pool) {
      if (out.length >= min) break;
      const lk = String(k).toLowerCase();
      if (!local.has(lk) && !globalSeen.has(lk)) {
        out.push(k);
        local.add(lk);
        globalSeen.add(lk);
      }
    }
    return out;
  };

  const globalSeen = new Set(seen);
  const ensured = cleaned.map(g => ({
    ...g,
    keywords: g.keywords.length >= min ? g.keywords : addIfPossible(g.keywords, globalSeen)
  }));

  return ensured;
}

// Determine whether skills contain concrete technologies rather than only abstract categories
function hasConcreteTech(skills) {
  if (!Array.isArray(skills)) return false;
  const techPattern = /(python|fastapi|flask|node|node\.js|react|angular|typescript|javascript|tailwind|docker|kubernetes|gcp|aws|azure|postgres|postgresql|mysql|mongodb|redis|pytorch|tensorflow|langchain|supabase|groq|pinecone|graphql|ci\/cd|jwt|golang|go)/i;
  return skills.some(g => Array.isArray(g.keywords) && g.keywords.some(k => techPattern.test(String(k))));
}

// Mine technologies from work and project descriptions/highlights
function extractTechFromContent({ work = [], projects = [] }) {
  const bag = new Set();
  const add = (s) => {
    const tokens = String(s || '')
      .split(/[^A-Za-z0-9+.#/-]+/)
      .map(t => t.trim())
      .filter(Boolean);
    tokens.forEach(t => {
      const normalized = t.replace(/[,.;]$/, '');
      const keep = /^(python|fastapi|flask|node\.js|express|react|angular|typescript|javascript|tailwind|html|css|docker|kubernetes|gcp|google|aws|azure|postgres|postgresql|mongodb|mysql|redis|pytorch|tensorflow|scikit|pandas|numpy|langchain|groq|pinecone|supabase|graphql|jwt|oauth|rest|api|kafka|rabbitmq|airflow|cloud run|secret manager|ci|cd)$/i;
      if (keep.test(normalized)) bag.add(normalized);
    });
  };

  work.forEach(w => {
    add(w.company);
    add(w.position);
    add(w.summary);
    (w.highlights || []).forEach(add);
  });
  projects.forEach(p => {
    add(p.name);
    add(p.description);
    (p.highlights || []).forEach(add);
  });

  // Normalize a few aliases
  const aliases = new Map([
    ['google', 'GCP'],
    ['node.js', 'Node.js'],
    ['express', 'Express.js'],
    ['postgresql', 'PostgreSQL'],
    ['ci', 'CI/CD'],
    ['cd', 'CI/CD']
  ]);
  const out = Array.from(bag).map(v => aliases.get(v.toLowerCase()) || v);
  return out;
}

// Ensure basics.location renders nicely in themes that expect region/country
function normalizeBasicsLocation(basics) {
  const out = { ...basics };
  const loc = typeof out.location === 'object' ? { ...out.location } : {};
  // If only city provided with US country, set region to 'US' to satisfy themes printing city, region
  if (loc.city && !loc.region && loc.countryCode === 'US') loc.region = 'US';
  // Synthesize address like "City, CC" when address absent
  if (loc.city && !loc.address && (loc.region || loc.countryCode)) {
    const tail = loc.region || loc.countryCode;
    loc.address = `${loc.city}, ${tail}`;
  }
  out.location = loc;
  return out;
}

// Ensure website and GitHub presence in basics for theme rendering
function ensureWebsiteAndGithub(basics) {
  const out = { ...basics };
  // Prefer explicit url field for personal site if present in profiles
  if (!out.url) {
    const website = (out.profiles || []).find(p => (p.network || '').toLowerCase() === 'website');
    if (website?.url) out.url = website.url;
  }
  // Ensure GitHub profile entry exists with URL
  const profiles = Array.isArray(out.profiles) ? [...out.profiles] : [];
  const ghIdx = profiles.findIndex(p => (p.network || '').toLowerCase() === 'github');
  if (ghIdx >= 0) {
    const p = { ...profiles[ghIdx] };
    if (!p.url && p.username) p.url = `https://github.com/${p.username}`;
    profiles[ghIdx] = p;
  } else if (out.username || out.github || out.githubUsername) {
    const username = out.username || out.github || out.githubUsername;
    profiles.push({ network: 'GitHub', username, url: `https://github.com/${username}` });
  }
  out.profiles = profiles;
  return out;
}

function ensureMinimumKeywords(groups, supplementPool, min = 5) {
  const pool = Array.isArray(supplementPool) ? Array.from(new Set(supplementPool)) : [];
  const takeMore = (existing) => {
    const lower = new Set((existing || []).map(x => String(x).toLowerCase()));
    const added = [];
    for (const k of pool) {
      if (added.length + (existing?.length || 0) >= min) break;
      if (!lower.has(String(k).toLowerCase())) added.push(k);
    }
    return (existing || []).concat(added);
  };

  return (Array.isArray(groups) ? groups : []).map(g => ({
    ...g,
    keywords: (g.keywords && g.keywords.length >= min) ? g.keywords : takeMore(g.keywords)
  }));
}
