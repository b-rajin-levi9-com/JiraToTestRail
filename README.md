# Jira to TestRail Gherkin Scenario Sync Tool

A Node.js CLI tool that automatically extracts Gherkin-style scenarios from Jira ticket descriptions and syncs them into TestRail as individual test cases. This ensures that every documented scenario becomes a properly managed and traceable TestRail test without requiring manual copy/paste.

## Features

- **Automatic Extraction**: Parses Gherkin-style scenarios from Jira ticket descriptions
- **Idempotent Sync**: Updates existing test cases if scenario name matches, creates new ones otherwise
- **Traceability**: Links TestRail test cases back to Jira tickets via references field
- **Suite & Section Support**: Use suite ID with automatic section detection or specify section by name
- **Multi-line Titles**: Supports scenario titles spanning multiple lines
- **Dry Run Mode**: Preview changes before applying them
- **Comprehensive Logging**: Clear feedback on all operations
- **Error Handling**: Detailed error messages for troubleshooting

## Prerequisites

- **Node.js**: Version 18 or higher
- **Jira Account**: 
  - Instance URL (e.g., `https://yourcompany.atlassian.net`)
  - API token ([How to create a Jira API token](https://support.atlassian.com/atlassian-account/docs/manage-api-tokens-for-your-atlassian-account/))
  - Project key/ID
- **TestRail Account**:
  - Instance URL (e.g., `https://yourcompany.testrail.io`)
  - API credentials (username/email + API key)
  - Project ID
  - Suite ID or Section ID (where test cases will be created)

## Installation

1. Clone or download this repository
2. Install dependencies:
   ```bash
   npm install
   ```
3. Build the project:
   ```bash
   npm run build
   ```

## Configuration

1. Create a `.env` file in the project root (copy from `.env.example`):
   ```bash
   cp .env.example .env
   ```

2. Edit `.env` with your credentials:
   ```env
   # Jira Configuration
   JIRA_URL=https://yourcompany.atlassian.net
   JIRA_EMAIL=your-email@example.com
   JIRA_API_TOKEN=your-jira-api-token

   # TestRail Configuration
   TESTRAIL_URL=https://yourcompany.testrail.io
   TESTRAIL_USERNAME=your-email@example.com
   TESTRAIL_API_KEY=your-testrail-api-key

   # TestRail Project Configuration (can be overridden via CLI)
   TESTRAIL_PROJECT_ID=1
   ```

### Getting Your TestRail API Key

1. Log in to TestRail
2. Click on your user profile (top right)
3. Select "My Settings"
4. Scroll to "API" section
5. Click "Add API Key" or copy existing key

## Usage

### Basic Sync

Sync scenarios from a Jira ticket to TestRail. You can use either `--suite-id` or `--section-id`:

**Using Suite ID (recommended):**
```bash
npm run sync -- sync PROJ-123 --suite-id 6 --project-id 2
```

**Using Suite ID with specific section name:**
```bash
npm run sync -- sync PROJ-123 --suite-id 6 --section-name "Test Cases" --project-id 2
```

**Using Suite ID with subsection (hierarchical path):**
```bash
npm run sync -- sync PROJ-123 --suite-id 6 --section-name "Parent Section/Subsection Name" --project-id 2
```

**Using Suite ID with nested subsections (multiple levels):**
```bash
npm run sync -- sync PROJ-123 --suite-id 6 --section-name "Parent/Subsection/Sub-subsection" --project-id 2
```

**Using Section ID directly (works for subsections too):**
```bash
npm run sync -- sync PROJ-123 --section-id 12345 --project-id 2
```

### Options

- `--suite-id <id>`: TestRail suite ID (will use first section or specified section-name)
- `--section-id <id>`: TestRail section ID (alternative to --suite-id, works for subsections too)
- `--section-name <name>`: Section name to use when --suite-id is provided (case-insensitive). Supports hierarchical paths like "Parent Section/Subsection Name" or "Parent/Subsection/Sub-subsection" for nested subsections
- `--project-id <id>`: TestRail project ID (overrides `TESTRAIL_PROJECT_ID` from `.env`)
- `--dry-run`: Preview changes without applying them
- `--verbose`: Enable detailed logging

**Note:** Either `--suite-id` or `--section-id` must be provided, but not both.

### Examples

**Dry run to preview changes:**
```bash
npm run sync -- sync PROJ-123 --suite-id 6 --section-name "Test Cases" --project-id 2 --dry-run
```

**Specify project ID explicitly:**
```bash
npm run sync -- sync PROJ-123 --suite-id 6 --project-id 2
```

**Verbose logging:**
```bash
npm run sync -- sync PROJ-123 --suite-id 6 --section-name "Test Cases" --project-id 2 --verbose
```

**Using section ID directly:**
```bash
npm run sync -- sync PROJ-123 --section-id 12345 --project-id 2
```

## Gherkin Scenario Format

The tool recognizes scenarios in the following formats:

### Format 1: Explicit Scenario Marker
```
Scenario 1: User login
When user enters valid credentials
And clicks login button
Then user is logged in
And redirected to dashboard
```

### Format 2: Multiple Scenarios
```
Scenario 1: Successful login
When user enters valid credentials
Then user is logged in

Scenario 2: Failed login
When user enters invalid credentials
Then error message is displayed
```

### Format 3: Without Scenario Number
```
Scenario: User registration
Given user is on registration page
When user fills in required fields
Then account is created
```

### Format 4: Multi-line Title (Title on Next Line)
```
Scenario 1:
User login
When user enters valid credentials
Then user is logged in
```

### Format 5: Multi-line Title (Multiple Lines)
```
Scenario 1:
Multi-line
title here
When user enters valid credentials
Then user is logged in
```

### Format 6: Title on Same Line as Scenario
```
Scenario 1: User login
When user enters valid credentials
Then user is logged in
```

**Supported Features:**
- **Scenario markers**: `Scenario 1:`, `Scenario:`, `Scenario1:` (with or without number, with or without colon)
- **Step keywords**: `Given`, `When`, `Then`, `And`, `But` (case-insensitive)
- **Multi-line titles**: Title can span multiple lines
- **Blank lines**: Blank lines between title and steps are supported
- **Multiple scenarios**: Multiple scenarios in one description

**The parser extracts:**
- **Scenario name**: From "Scenario X:" or "Scenario:" line(s) - multi-line titles are joined with spaces
- **Steps**: All Given/When/Then/And/But statements before the last "Then"
- **Expected result**: Last "Then" statement and any following "And" statements

## How It Works

1. **Fetch Jira Ticket**: Retrieves ticket description using Jira REST API
2. **Parse Scenarios**: Extracts Gherkin-style scenarios using regex patterns
3. **Check Existing**: Fetches existing test cases from TestRail section
4. **Create or Update**: 
   - Creates new test case if scenario name doesn't exist
   - Updates existing test case if scenario name matches
5. **Link Back**: Adds Jira ticket reference to TestRail test case

## TestRail Test Case Structure

Each synced scenario becomes a TestRail test case with:

- **Title**: Scenario name from Jira (multi-line titles are joined with spaces)
- **Preconditions**: Jira ticket ID and link
- **Steps**: All Given/When/Then/And/But steps **before** the last "Then" statement
- **Expected Result**: The last "Then" statement and any following "And" statements
- **References**: Jira ticket key for traceability

**Example:**
For a scenario with:
```
When user enters valid credentials
And clicks login button
Then user is logged in
And redirected to dashboard
```

**Steps field will contain:**
- When user enters valid credentials
- And clicks login button

**Expected Result field will contain:**
- Then user is logged in
- And redirected to dashboard

## Troubleshooting

### "Missing required environment variables"
- Ensure `.env` file exists and contains all required variables
- Check that variable names match exactly (case-sensitive)

### "Jira ticket not found"
- Verify the ticket key format (e.g., PROJ-123)
- Check that you have access to the Jira project
- Verify your Jira API token is valid

### "TestRail authentication failed"
- Verify your TestRail username and API key
- Check that API key hasn't expired
- Ensure TestRail URL is correct (include https://)

### "No scenarios found"
- Ensure ticket description contains Gherkin-style scenarios
- Check that scenarios follow the expected format (see above)
- Try using `--verbose` flag to see what was parsed

### "Invalid section ID" or "No sections found in suite"
- If using `--suite-id`, verify the suite ID exists and contains sections
- If using `--section-id`, verify the section ID exists in TestRail
- Ensure you have permissions to create test cases in that section
- Check that section belongs to the specified project
- When using `--section-name`, verify the section name matches exactly (case-insensitive)
- Use `--verbose` flag to see available sections in a suite

### Network Errors
- Verify your internet connection
- Check that Jira/TestRail URLs are accessible
- Ensure no firewall is blocking API requests

## Development

### Project Structure

```
JiraTestRail/
├── src/
│   ├── index.ts              # Main CLI entry point
│   ├── jira/
│   │   └── jiraClient.ts     # Jira API client
│   ├── testrail/
│   │   └── testrailClient.ts # TestRail API client
│   ├── parser/
│   │   └── gherkinParser.ts  # Gherkin scenario extraction
│   ├── sync/
│   │   └── syncService.ts    # Orchestration logic
│   └── utils/
│       ├── logger.ts         # Logging utility
│       └── config.ts         # Configuration management
├── .env.example              # Environment variable template
├── package.json
├── tsconfig.json
└── README.md
```

### Building

```bash
npm run build
```

### Development Mode

```bash
npm run dev sync PROJ-123 --section-id 12345
```

## Limitations

- Currently supports basic Gherkin syntax (Given/When/Then/And/But)
- Scenarios must be in the ticket description (not in comments)
- Test case matching is based on exact title match (case-insensitive)
- HTML descriptions are converted to plain text (ADF format supported)
- Does not support:
  - `*` (alternative step keyword)
  - `Background:` sections
  - `Feature:` blocks
  - `Scenario Outline:` with examples
  - Data tables (pipe-separated)
  - Doc strings (triple quotes)
- Multi-line scenario titles are joined with spaces (newlines converted to spaces)

## Contributing

Feel free to submit issues or pull requests for improvements.

## License

MIT

