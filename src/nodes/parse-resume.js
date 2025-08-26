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

  const system = `You are a resume parser. Return only valid JSON that strictly conforms to JSON Resume v1.0.0 schema.
Required top-level keys (omit empty): basics, work[], education[], skills[], projects[], meta.
Rules:
- Ignore headers/footers, timestamps, URL tracking params, and pagination (e.g., "2 of 4").
- basics: include name, email, phone, url (personal website if present), summary, location { address, city, region, countryCode, postalCode }, profiles[] { network, username, url } when present.
- work: set BOTH employer fields when possible: { name: employerName, company: employerName }. Include position, location, url, startDate, endDate, summary, highlights[]. Dates must be ISO-like "YYYY-MM" or "YYYY-MM-DD". Use endDate only if present; otherwise omit.
  - CRITICAL: Preserve bullet content VERBATIM in highlights[]. Do NOT shorten, paraphrase, or remove metrics/technologies.
  - Include 3–7 highlights per role when available. Keep punctuation and numbers intact.
- education: institution, area, studyType, startDate, endDate, url if present.
- skills: array of objects with { name, keywords[] }.
  - If the resume contains grouped/categorized technical skills (e.g., lines like "• Backend Development & Infrastructure: Python, FastAPI, ..."), you MUST:
    - Set skills[i].name to the category label exactly as written (e.g., "Backend Development & Infrastructure").
    - Parse the comma-separated items after the colon into skills[i].keywords as concrete technologies/tools only.
    - Do NOT place category names or generic labels (e.g., "Backend Development & Infrastructure", "Frontend Development & UI Engineering") into keywords.
    - Preserve all concrete items present; do not collapse all categories into a single "Skills" group when categories exist in the text.
  - If there are no explicit categories, you may produce a single { name: "Skills", keywords }.
- projects: name, description, highlights[].
  - CRITICAL: Keep description as 1–3 full sentences. Put details/metrics/stack into 2–5 highlights, preserving original wording and numbers.
- meta: include { version: "v1.0.0" } and any contextual info.
- Do not fabricate data. Only include fields findable in the text. Omit unknowns.`;

  const preset = {
    "$schema": "https://raw.githubusercontent.com/jsonresume/resume-schema/v1.0.0/schema.json",
    basics: {
      name: "",
      email: "",
      phone: "",
      url: "",
      summary: "",
      location: { address: "", city: "", region: "", countryCode: "", postalCode: "" },
      profiles: [ { network: "", username: "", url: "" } ]
    },
    work: [ { company: "", position: "", location: "", url: "", startDate: "", endDate: "", summary: "", highlights: [] } ],
    education: [ { institution: "", area: "", studyType: "", startDate: "", endDate: "", url: "" } ],
    skills: [ { name: "", keywords: [] } ],
    projects: [ { name: "", description: "", highlights: [] } ],
    meta: { version: "v1.0.0" }
  };

  // Structured Outputs JSON Schema focused on enforcing categorized skills
  const jsonResumeSchema = {
    name: 'json_resume_v1',
    schema: {
      type: 'object',
      additionalProperties: true,
      properties: {
        $schema: { type: 'string' },
        basics: {
          type: 'object',
          additionalProperties: true
        },
        work: { type: 'array', items: { type: 'object', additionalProperties: true } },
        education: { type: 'array', items: { type: 'object', additionalProperties: true } },
        projects: { type: 'array', items: { type: 'object', additionalProperties: true } },
        skills: {
          type: 'array',
          minItems: 1,
          items: {
            type: 'object',
            required: ['name', 'keywords'],
            additionalProperties: false,
            properties: {
              name: { type: 'string', minLength: 2 },
              keywords: {
                type: 'array',
                minItems: 1,
                items: {
                  type: 'string',
                  minLength: 1,
                  // Discourage category labels being returned as keywords
                  not: {
                    pattern: '(Backend Development|Frontend Development|UI Engineering|Practices|Infrastructure|Data Engineering|DevOps)'
                  }
                }
              }
            }
          }
        },
        meta: { type: 'object', additionalProperties: true }
      },
      required: []
    }
  };

  const prompt = `Fill this JSON Resume v1.0.0 template with values extracted from the resume text. Only include keys with values; omit empty ones.
Constraints:
- skills must be an array of { name, keywords[] }.
- If skills are categorized in the text (e.g., "Backend Development & Infrastructure: ...", "Frontend Development & UI Engineering: ..."), output one skills object per category with that exact category in name and only concrete technologies/tools in keywords.
- Never include category labels themselves as keywords. Avoid keywords like "Backend Development & Infrastructure", "Frontend Development & UI Engineering", "Practices", etc.
- Dates must be in YYYY-MM or YYYY-MM-DD format. Use endDate only if present.
- Include basics.location fields if present in text. Include profiles[] with GitHub/LinkedIn URLs when available.
- When you detect an employer name, set it on both work.name and work.company so themes that rely on either field will render it.
- If a GitHub username is present but a URL is missing, set profiles[].url to https://github.com/<username>.
- If a personal website is present, set basics.url to that URL.
- Do NOT summarize bullets. Copy bullet-like lines into work.highlights and projects.highlights verbatim (preserve metrics, stack, and punctuation).

Example for skills parsing (from text like the user's original):
Input lines:
• Backend Development & Infrastructure: Python, FastAPI, Flask, Node.js, Express.js, Docker
• Frontend Development & UI Engineering: JavaScript, TypeScript, React.js, Angular, Tailwind CSS
Output skills:
[
  { "name": "Backend Development & Infrastructure", "keywords": ["Python", "FastAPI", "Flask", "Node.js", "Express.js", "Docker"] },
  { "name": "Frontend Development & UI Engineering", "keywords": ["JavaScript", "TypeScript", "React.js", "Angular", "Tailwind CSS"] }
]

Template:\n${JSON.stringify(preset, null, 2)}

Resume Text:\n\n${pdfText.substring(0, 150000)}`;

  let content;
  try {
    // Try structured outputs first
    const response = await client.chat.completions.create({
      model: process.env.OPENAI_MODEL,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: prompt }
      ],
      response_format: { type: 'json_schema', json_schema: jsonResumeSchema }
    });
    content = response.choices?.[0]?.message?.content;
  } catch (e) {
    logger.warn('Structured outputs failed, falling back to json_object', { error: e.message });
    const response = await client.chat.completions.create({
      model: process.env.OPENAI_MODEL,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: prompt }
      ],
      response_format: { type: 'json_object' }
    });
    content = response.choices?.[0]?.message?.content;
  }

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
