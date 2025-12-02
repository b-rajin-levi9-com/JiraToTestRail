import * as dotenv from 'dotenv';

dotenv.config();

export interface Config {
  jira: {
    url: string;
    email: string;
    apiToken: string;
  };
  testrail: {
    url: string;
    username: string;
    apiKey: string;
    projectId?: number;
  };
}

function validateConfig(): Config {
  const jiraUrl = process.env.JIRA_URL;
  const jiraEmail = process.env.JIRA_EMAIL;
  const jiraApiToken = process.env.JIRA_API_TOKEN;
  const testrailUrl = process.env.TESTRAIL_URL;
  const testrailUsername = process.env.TESTRAIL_USERNAME;
  const testrailApiKey = process.env.TESTRAIL_API_KEY;
  const testrailProjectId = process.env.TESTRAIL_PROJECT_ID
    ? parseInt(process.env.TESTRAIL_PROJECT_ID, 10)
    : undefined;

  const missing: string[] = [];

  if (!jiraUrl) missing.push('JIRA_URL');
  if (!jiraEmail) missing.push('JIRA_EMAIL');
  if (!jiraApiToken) missing.push('JIRA_API_TOKEN');
  if (!testrailUrl) missing.push('TESTRAIL_URL');
  if (!testrailUsername) missing.push('TESTRAIL_USERNAME');
  if (!testrailApiKey) missing.push('TESTRAIL_API_KEY');

  if (missing.length > 0) {
    throw new Error(
      `Missing required environment variables: ${missing.join(', ')}\n` +
      'Please create a .env file based on .env.example'
    );
  }

  return {
    jira: {
      url: jiraUrl!,
      email: jiraEmail!,
      apiToken: jiraApiToken!,
    },
    testrail: {
      url: testrailUrl!,
      username: testrailUsername!,
      apiKey: testrailApiKey!,
      projectId: testrailProjectId,
    },
  };
}

export const config = validateConfig();

