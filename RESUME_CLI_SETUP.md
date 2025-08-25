# Resume-CLI Setup and Configuration Guide

## Overview
This document provides comprehensive instructions for setting up and configuring the resume-cli locally within the resume-patch project. The resume-cli is used to convert JSON Resume format files to HTML and PDF formats.

## Installation

### Prerequisites
- Node.js 18+ 
- npm package manager
- Project directory with package.json

### Install resume-cli
```bash
# Install resume-cli locally within the project
npm install resume-cli

# Verify installation
npx resume --version
# Expected output: 3.0.8
```

### Install Themes
```bash
# Install working themes
npm install jsonresume-theme-even --legacy-peer-deps

# Note: Some themes may have compatibility issues
# jsonresume-theme-professional has JSX syntax errors
```

## Configuration

### Basic CLI Usage
The resume-cli provides several commands for working with JSON Resume files:

```bash
# Validate JSON Resume schema
npx resume validate --resume <filename>.json

# Export to HTML
npx resume export <output>.html --resume <filename>.json --format html

# Export to PDF (may have Puppeteer issues)
npx resume export <output>.pdf --resume <filename>.json --format pdf

# Serve resume locally
npx resume serve --resume <filename>.json --port <port> --silent
```

### Theme Configuration
```bash
# Use specific theme for export
npx resume export <output>.html --resume <filename>.json --theme jsonresume-theme-even --format html

# Available themes in this project:
# - jsonresume-theme-even (default, fully functional)
# - jsonresume-theme-professional (has JSX compatibility issues)
```

### Server Configuration
```bash
# Serve with custom port
npx resume serve --resume <filename>.json --port 4001

# Silent mode (no browser auto-open)
npx resume serve --resume <filename>.json --port 4001 --silent

# Background execution
npx resume serve --resume <filename>.json --port 4001 --silent &
```

## Working Commands

### ✅ Fully Functional Commands
```bash
# Validation
npx resume validate --resume test-resume.json

# HTML Export (default theme)
npx resume export test-resume.html --resume test-resume.json --format html

# HTML Export (explicit theme)
npx resume export test-resume.html --resume test-resume.json --theme jsonresume-theme-even --format html

# Local Server
npx resume serve --resume test-resume.json --port 4001 --silent
```

### ⚠️ Commands with Issues
```bash
# PDF Export - Puppeteer dependency error
npx resume export test-resume.pdf --resume test-resume.json --format pdf
# Error: spawn Unknown system error -86

# Professional theme - JSX syntax errors
npx resume export test-resume.html --resume test-resume.json --theme jsonresume-theme-professional --format html
# Error: SyntaxError: Unexpected token '<'
```

## File Structure

### Input Format
The CLI expects JSON Resume format files with the following structure:
```json
{
  "basics": {
    "name": "John Doe",
    "label": "Software Engineer",
    "email": "john.doe@example.com",
    "summary": "Experienced software engineer...",
    "location": { ... },
    "profiles": [ ... ]
  },
  "work": [ ... ],
  "education": [ ... ],
  "skills": [ ... ],
  "projects": [ ... ],
  "meta": {
    "theme": "jsonresume-theme-even"
  }
}
```

### Output Files
- **HTML**: Fully styled resume with CSS and responsive design
- **PDF**: Requires Puppeteer (currently has dependency issues)
- **Server**: Local HTTP server for preview

## Troubleshooting

### Common Issues

#### 1. Puppeteer PDF Export Error
**Error**: `spawn Unknown system error -86`
**Cause**: Puppeteer dependency issues
**Solution**: Use HTML export instead, or investigate Puppeteer installation

#### 2. Theme Compatibility Issues
**Error**: `SyntaxError: Unexpected token '<'`
**Cause**: JSX syntax in themes not compatible with current Node.js version
**Solution**: Use jsonresume-theme-even which is fully compatible

#### 3. React Version Conflicts
**Error**: `ERESOLVE unable to resolve dependency tree`
**Cause**: Theme dependencies conflict with project React version
**Solution**: Use `--legacy-peer-deps` flag during installation

### Dependency Resolution
```bash
# Install themes with legacy peer deps
npm install jsonresume-theme-professional --legacy-peer-deps

# Fix dependency conflicts
npm audit fix
npm audit fix --force  # Use with caution
```

## Integration with resume-patch Project

### Workflow Integration
The resume-cli is integrated into the resume-patch workflow through the export node:

```javascript
// src/nodes/export.js
import { exportToPDF, exportToJSON } from '../utils/export-utils.js';

export async function exportNode(state) {
  // Export to JSON Resume format
  const jsonPath = await exportToJSON(state.final_resume, `${outputPath}.json`);
  
  // Export to PDF using resume-cli
  const pdfPath = await exportToPDF(state.final_resume, `${outputPath}.pdf`);
  
  return {
    output_files: { json: jsonPath, pdf: pdfPath }
  };
}
```

### CLI Commands in Workflow
```bash
# Export optimized resume to HTML
npx resume export optimized-resume.html --resume optimized-resume.json --theme jsonresume-theme-even --format html

# Export optimized resume to PDF (when Puppeteer issues resolved)
npx resume export optimized-resume.pdf --resume optimized-resume.json --theme jsonresume-theme-even --format pdf
```

## Performance Considerations

### Export Times
- **HTML Export**: ~1-2 seconds
- **PDF Export**: ~3-5 seconds (when working)
- **Server Startup**: ~1 second

### File Sizes
- **Input JSON**: ~4-8KB typical
- **Output HTML**: ~12-15KB with CSS
- **Output PDF**: ~50-100KB typical

## Best Practices

### 1. Theme Selection
- Use `jsonresume-theme-even` for reliable functionality
- Test themes before production use
- Avoid themes with JSX syntax issues

### 2. File Management
- Keep JSON files in version control
- Generate HTML/PDF files as needed
- Use descriptive output filenames

### 3. Server Usage
- Use unique ports for multiple instances
- Always use `--silent` flag in automated scripts
- Kill background processes after use

### 4. Error Handling
- Always validate JSON before export
- Check for theme compatibility issues
- Have fallback export formats ready

## Future Improvements

### Planned Enhancements
1. **PDF Export Fix**: Resolve Puppeteer dependency issues
2. **Theme Compatibility**: Test and fix additional themes
3. **Performance**: Optimize export times for large resumes
4. **Integration**: Enhance workflow integration with error handling

### Alternative Solutions
- **HTML to PDF**: Use wkhtmltopdf or similar tools
- **Browser Automation**: Implement custom PDF generation
- **Cloud Services**: Use external PDF generation services

## Support and Maintenance

### Version Information
- **resume-cli**: 3.0.8
- **jsonresume-theme-even**: 0.23.0
- **Node.js**: 24.6.0
- **npm**: 9.x

### Maintenance Commands
```bash
# Update resume-cli
npm update resume-cli

# Check for outdated packages
npm outdated

# Clean install
rm -rf node_modules package-lock.json
npm install
```

### Documentation Updates
This document should be updated when:
- New themes are tested and verified
- PDF export issues are resolved
- New CLI features are added
- Compatibility issues are discovered

---

*Last updated: August 25, 2025*
*Project: resume-patch*
*Maintainer: Development Team*
