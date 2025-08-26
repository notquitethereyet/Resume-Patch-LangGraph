import 'dotenv/config';
import fs from 'fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import pdf from 'pdf-parse-new';
import OpenAI from 'openai';
import { logger } from '../utils/logger.js';
import { ProcessingError } from '../utils/error-handler.js';

function normalizePdfText(text) {
  return (text || '')
    .replace(/[\u00A0\uFEFF]/g, ' ')
    .replace(/[\r\t]/g, ' ')
    .replace(/[ ]{2,}/g, ' ')
    .replace(/\n\s*/g, '\n')
    .trim();
}

async function aiParseJsonResume(pdfText) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error('OPENAI_API_KEY is not set');
  const client = new OpenAI({ apiKey });

  const system = `You are a resume parser. Return only valid JSON.
Your goal is to extract the data needed for resume optimization: basics, work[], education[], skills[], projects[].
Rules:
- Ignore page headers/footers, timestamps, URLs with theme params, and page numbering like "2 of 4".
- Extract all available sections: Work Experience, Education, Skills, and Projects.
- Work parsing rules:
  - If a role line contains a title and dates (e.g., "Senior Developer May 2020 — May 2021"), and the next line is a company name, use that as company.
  - Keep highlights as bullet-like lines; do not invent.
  - Use location if present near company or role; otherwise omit.
- Education parsing rules:
  - Extract institution name, degree type, field of study, and dates if available.
  - Include both undergraduate and graduate degrees.
- Skills rules:
  - Return a flat, deduplicated array of skill names as strings (no categories, no grouping objects).
  - Split on commas, slashes, or bullets; trim whitespace; keep concise canonical names (e.g., "React", "Node.js").
- Projects parsing rules:
  - Extract project names, descriptions, and key highlights.
  - Include technologies used and outcomes achieved.
- Do not fabricate missing information. Omit fields that are not present in the text.`;

  const preset = {
    basics: { name: '', email: '', phone: '', location: { address: '' } },
    work: [
      {
        company: '',
        position: '',
        location: '',
        startDate: '',
        endDate: '',
        summary: '',
        highlights: []
      }
    ],
    education: [
      {
        institution: '',
        area: '',
        studyType: '',
        startDate: '',
        endDate: ''
      }
    ],
    skills: [
      { name: '' }
    ],
    projects: [
      {
        name: '',
        description: '',
        highlights: []
      }
    ]
  };

  const prompt = `Fill the following JSON template with values extracted from the resume text. Only include keys with values; omit empty ones.
Important: skills must be an array of objects { name }, where name is a single skill term. Do not return categories.

Template:\n${JSON.stringify(preset, null, 2)}

Resume Text:\n\n${pdfText.substring(0, 150000)}`;

  const response = await client.chat.completions.create({
    model: 'gpt-4o-mini',
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: prompt }
    ],
    response_format: { type: 'json_object' },
    temperature: 0
  });

  const content = response.choices?.[0]?.message?.content;
  if (!content) throw new Error('No content from OpenAI');
  let parsed;
  try { parsed = JSON.parse(content); } catch (e) { throw new Error('OpenAI did not return valid JSON'); }
  // Ensure structure
  if (!parsed || typeof parsed !== 'object') throw new Error('Invalid JSON structure');
  parsed.basics = parsed.basics || {};
  parsed.work = Array.isArray(parsed.work) ? parsed.work : [];
  parsed.education = Array.isArray(parsed.education) ? parsed.education : [];
  parsed.skills = Array.isArray(parsed.skills) ? parsed.skills : [];
  parsed.projects = Array.isArray(parsed.projects) ? parsed.projects : [];
  return parsed;
}

async function validateWithResumeCLI(jsonResume, allowDisk) {
  if (!allowDisk) {
    logger.info('Skipping resume-cli validation (disk disabled)');
    return;
  }
  // Best-effort local validation via resume-cli; non-fatal on failure
  const binPath = path.join(process.cwd(), 'node_modules', '.bin', 'resume');
  const tmpFile = path.join(os.tmpdir(), `resume-validate-${Date.now()}.json`);
  try {
    await fs.writeFile(tmpFile, JSON.stringify(jsonResume, null, 2), 'utf8');
    await new Promise((resolve, reject) => {
      execFile(binPath, ['validate', '--resume', tmpFile], (error, stdout, stderr) => {
        if (error) {
          logger.warn('resume-cli validation failed', { error: error.message, stderr });
          return resolve();
        }
        logger.info('resume-cli validation succeeded');
        resolve();
      });
    });
  } catch (e) {
    logger.warn('resume-cli validation skipped', { error: e.message });
  } finally {
    try { await fs.unlink(tmpFile); } catch {}
  }
}

export async function parseResumeNode(state) {
  logger.info('📄 Parsing resume...', { path: state.resume.path });
  try {
    const dataBuffer = await fs.readFile(state.resume.path);
    const pdfData = await pdf(dataBuffer);
    const rawText = pdfData.text || '';

    logger.info('PDF parsed successfully', {
      size: dataBuffer.length,
      path: state.resume.path,
      textLength: rawText.length
    });

    const text = normalizePdfText(rawText);
    const jsonResume = await aiParseJsonResume(text);
    // Optional schema validation via resume-cli (local)
    const allowDisk = Boolean(state.allow_disk);
    await validateWithResumeCLI(jsonResume, allowDisk);

    state.resume.content = state.resume.content || {};
    state.resume.content.jsonResume = jsonResume;
    state.resume.parsed = true;

    logger.info('Resume converted to JSON Resume format', {
      hasBasics: !!jsonResume.basics,
      hasWork: Array.isArray(jsonResume.work) && jsonResume.work.length > 0,
      hasSkills: Array.isArray(jsonResume.skills) && jsonResume.skills.length > 0
    });

    return state;
  } catch (err) {
    logger.error('Failed to parse resume', { error: err.message });
    throw new ProcessingError('Failed to parse resume PDF');
  }
}
