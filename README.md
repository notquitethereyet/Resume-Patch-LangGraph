# Resume Patch

AI-powered resume optimization tool using LangGraph for intelligent workflow management.

## Features

- **AI Resume Parsing (GPT-4o)**: Parses PDF text and returns structured JSON Resume (basics, work, skills) using OpenAI GPT-4o (json_object)
- **Focus Areas**: Prioritizes Work Experience and Skills for downstream optimization
- **Job Description Analysis**: Fetch and analyze job descriptions from URLs or text
- **AI-Powered Patch Generation**: Uses GPT-4o to intelligently identify and prioritize the most valuable resume improvements
- **Interactive Patch Approval**: Review and approve suggested resume improvements before application
- **Automated Optimization**: Generate and apply approved JSON patches to improve resumes (work/skills only)
- **Multiple Export Formats**: Export optimized resumes in PDF and HTML formats
- **CLI Interface**: Easy-to-use command-line tool with interactive prompts

## Installation

```bash
npm install
```

## Configuration

Add `.env` with:

```bash
OPENAI_API_KEY=sk-...
```

## Usage

```bash
npm run start
# or
node test-parser.js
```

Notes:
- Parsing is AI-only: PDF -> text -> GPT-4o -> JSON Resume
- If the API returns invalid JSON, parsing will error; ensure `OPENAI_API_KEY` is set

## Notes

- For PDFs with unusual layouts, AI parsing generally yields better structure; the project automatically requests a structured JSON response.
- Heuristic fallback remains for offline or constrained environments.

## Usage

### Interactive CLI

Simply run the tool and follow the interactive prompts:

```bash
npm start
```

**What happens:**
1. **Select Resume**: Choose from PDF files in the current directory
2. **Input Method**: Choose between job URL or text input
3. **Job Description**: 
   - **URL**: Paste the job posting URL
   - **Text**: Paste or type the job description (press Enter twice when done)
4. **Options**: Configure auto-apply, disk access, and output path
5. **Optimization**: Review and approve patches interactively
6. **Export**: Get your optimized resume

### Command Line Options

For advanced users who prefer command-line arguments:

```bash
# Direct node execution
node src/index.js

# Development mode with auto-reload
npm run dev
```



### AI-Powered Patch Generation

The tool now uses GPT-4o to intelligently analyze your resume against the job description and generate high-quality, relevant patches:

- **Smart Skill Filtering**: AI identifies specific, valuable technologies (e.g., "React", "AWS Lambda") instead of vague terms (e.g., "API", "database", "Payment Systems")
- **Duplicate Prevention**: Automatically detects skills already present in your resume and prevents duplicate patch suggestions
- **Job-Specific Relevance**: Patches are tailored to the specific job requirements
- **Intelligent Prioritization**: AI ranks patches by impact and relevance
- **Quality Control**: Limits total patches to prevent overwhelming users
- **Smart Deduplication**: Eliminates redundant patches between skills and keywords sections
- **Fallback Support**: Gracefully degrades to basic filtering if AI is unavailable

### Enhanced Experience Alignment

The tool now provides sophisticated work experience optimization that goes beyond basic skills matching:

- **AI-Powered Experience Alignment**: Uses GPT-4o to analyze your work experience against the specific job requirements
- **Role-Specific Enhancements**: Automatically suggests additions that make your experience more relevant to the target role
- **Technology Stack Alignment**: Incorporates specific technologies, tools, and frameworks mentioned in the job description
- **Industry Terminology**: Uses industry-specific language and processes from the job posting
- **Achievement Enhancement**: Suggests measurable outcomes and metrics that demonstrate impact
- **Leadership Emphasis**: Highlights experience relevant to leadership and mentoring requirements
- **Contextual Relevance**: Ensures your experience descriptions align with the job's responsibilities

**Example**: If a job requires "React, AWS, and team leadership," the tool will suggest adding these technologies to your experience and emphasizing any team collaboration or mentoring experience you have.

### Patch Types & Actions

The tool generates different types of patches to optimize your resume:

| **Patch Type** | **What It Does** | **Priority** | **Impact** |
|----------------|------------------|--------------|------------|
| `add_skill` | Adds missing technical skills | High | High |
| `align_experience` | Aligns work experience with job requirements | High | High |
| `role_enhancement` | Adds role-specific enhancements | High | High |
| `enhance_experience` | Improves work experience descriptions | Medium | Medium |
| `add_keyword` | Adds job-specific keywords | Medium | Medium |
| `enhance_section` | Expands section content | Medium | Medium |
| `add_content` | Adds new content sections | Low | Low |
| `recommendation_based` | Follows AI analysis recommendations | Variable | Variable |

### Interactive Patch Approval

When patches are suggested, the CLI will present each one for your approval:

- **Individual Review**: Review each patch one by one with options to apply, skip, or get more details
- **Batch Operations**: Pause and review all remaining patches at once
- **Smart Defaults**: High-priority patches are pre-selected for approval
- **Detailed Information**: View patch impact, confidence, and estimated effort before deciding

### Export & Output

The tool exports optimized resumes in multiple formats:

- **JSON Resume**: Structured data with all resume sections (basics, work, education, skills)
- **PDF**: Professional PDF format using JSON Resume CLI themes
- **HTML**: Web-ready HTML format
- **Text Summary**: Human-readable summary of all resume sections
- **Patch Report**: Detailed report of all applied optimizations

**Note**: The export function now correctly preserves all resume data including work experience, education, and skills - not just the skills section.

Example interaction:
```
📋 Patch Approval Required
Found 3 suggested patches to review:

--- Patch 1/3 ---
🔴 Add skill: React
Type: add_skill
Impact: High impact on match score
Confidence: 90%
Value: React
Action: add_to_skills_section

What would you like to do with this patch?
❯ 1. Apply this patch
  2. Skip this patch
  3. Show more details
  4. Pause and review all patches
```

### Non-Interactive Mode

For automated workflows or when you want to apply all patches without review, you can select "Yes" when prompted for auto-apply during the interactive setup.

The tool will automatically approve and apply all suggested patches without prompting for user input.

### Development

```bash
# Run in development mode with auto-reload
npm run dev

# Run tests
npm test

# Lint code
npm run lint

# Format code
npm run format
```

### Security Options

- By default, processing is in-memory and avoids temporary disk writes.
- Use the `--allow-disk` flag to opt-in to local validation/export that writes temp files.

Example:

```bash
npm run start -- optimize resume.pdf --text "JD text..." --allow-disk
```

## Architecture

The application uses LangGraph to manage a workflow with the following nodes:

1. **Start**: Initialize the workflow
2. **Parse Resume**: Extract content from PDF resumes and map to JSON Resume
3. **Fetch JD**: Retrieve job descriptions from URLs or text
4. **Analyze**: Compare resume and job description for compatibility
5. **Suggest Patches**: Generate optimization recommendations
6. **Approve Patches**: Interactive CLI for user approval of suggested patches
7. **Apply Patches**: Implement only the approved improvements
8. **Export**: Generate the final optimized resume

## Project Structure

```
src/
├── index.js          # CLI entry point
├── workflow.js       # LangGraph workflow definition
└── nodes/            # Workflow node implementations
    ├── start.js
    ├── parse-resume.js
    ├── fetch-jd.js
    ├── analyze.js
    ├── suggest-patches.js
    ├── approve-patches.js  # Interactive patch approval
    ├── apply-patches.js
    └── export.js
```

## Dependencies

- **@langchain/langgraph**: Workflow management and state handling
- **@langchain/core**: Required by LangGraph runtime
- **@langchain/openai**: AI model integration
- **pdf-parse-new**: Primary PDF text extraction
- **pdfreader**: Fallback PDF text extraction
- **commander**: CLI argument parsing
- **inquirer**: Interactive user prompts
- **chalk**: Terminal color output

## Parsing Details

- Primary extraction: `pdf-parse-new`
- Fallback extraction: `pdfreader` when primary fails
- Normalization: cleans non-ASCII artifacts and whitespace before mapping
- Mapping output is placed under `resume.content.jsonResume` with:
  - `basics`: name, email, phone, location, summary
  - `work`: company, position, dates, summary
  - `education`: institution, area, studyType, dates
  - `skills`: list of skill objects
  - `projects`: name, description, keywords

## Development Status

This project is currently in active development. Recent updates include:
- **Interactive Patch Approval**: New CLI interface for reviewing and approving resume patches before application
- Robust PDF parsing with fallback and JSON Resume schema mapping in `src/nodes/parse-resume.js`.
- Exported `ResumeState` from `src/workflow.js` for tests and external consumers.
- Installed `@langchain/core` to satisfy LangGraph dependency.

## License

MIT
