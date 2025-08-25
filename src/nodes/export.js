import { logger } from '../utils/logger.js';
import { ProcessingError } from '../utils/error-handler.js';
import { createTempDir, cleanupTempFiles } from '../utils/file-utils.js';
import fs from 'fs/promises';
import path from 'node:path';

export async function exportNode(state) {
  logger.info('📤 Exporting optimized resume...');
  
  try {
    // Validate required data
    if (!state.resume?.patched) {
      throw new ProcessingError('Resume has not been patched yet');
    }
    
    if (!state.resume?.content?.sections) {
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
    
    // TODO: Generate PDF using JSON Resume CLI
    // This will be implemented when the CLI integration is complete
    exports.pdf = {
      content: null,
      format: 'pdf',
      status: 'pending_cli_integration',
      note: 'PDF generation requires JSON Resume CLI integration'
    };
    
    // TODO: Generate HTML using JSON Resume CLI
    exports.html = {
      content: null,
      format: 'html',
      status: 'pending_cli_integration',
      note: 'HTML generation requires JSON Resume CLI integration'
    };
    
  } catch (error) {
    logger.error('Error generating exports', { error: error.message });
    throw error;
  }
  
  return exports;
}

function generateJSONResume(resume) {
  const sections = resume.content.sections;
  
  return {
    basics: {
      name: extractName(sections.header || ''),
      email: extractEmail(sections.header || ''),
      phone: extractPhone(sections.header || ''),
      location: extractLocation(sections.header || ''),
      summary: sections.header || ''
    },
    work: parseWorkExperience(sections.experience || ''),
    education: parseEducation(sections.education || ''),
    skills: parseSkills(sections.skills || ''),
    projects: parseProjects(sections.projects || ''),
    meta: {
      patched: resume.patched,
      patchedAt: resume.patchedAt,
      appliedPatches: resume.appliedPatches?.length || 0,
      originalSections: Object.keys(resume.content.originalSections || {}),
      patchedSections: Object.keys(sections)
    }
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
