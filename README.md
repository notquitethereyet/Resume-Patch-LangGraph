# Resume Patch

AI-powered resume optimization tool using LangGraph for intelligent workflow management.

## Features

- **AI Resume Parsing (GPT-4o)**: Parses PDF text and returns structured JSON Resume (basics, work, skills) using OpenAI GPT-4o (json_object)
- **Focus Areas**: Prioritizes Work Experience and Skills for downstream optimization
- **Job Description Analysis**: Fetch and analyze job descriptions from URLs or text
- **Automated Optimization**: Generate and apply JSON patches to improve resumes (work/skills only)
- **Multiple Export Formats**: Export optimized resumes in PDF and HTML formats
- **CLI Interface**: Easy-to-use command-line tool

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

### Basic Usage

```bash
# Optimize resume against job description URL
npm start optimize resume.pdf --job "https://example.com/job-posting"

# Optimize resume against job description text
npm start optimize resume.pdf --text "Software Engineer position requiring Python, React, and AWS experience"

# Specify output path
npm start optimize resume.pdf --job "https://example.com/job" --output "optimized-resume.pdf"
```

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
6. **Apply Patches**: Implement the suggested improvements
7. **Export**: Generate the final optimized resume

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
- Robust PDF parsing with fallback and JSON Resume schema mapping in `src/nodes/parse-resume.js`.
- Exported `ResumeState` from `src/workflow.js` for tests and external consumers.
- Installed `@langchain/core` to satisfy LangGraph dependency.

## License

MIT
