import axios, { AxiosInstance } from 'axios';
import { config } from '../utils/config';
import { logger } from '../utils/logger';

export interface JiraTicket {
  key: string;
  summary: string;
  description: string;
  url: string;
}

export class JiraClient {
  private client: AxiosInstance;

  constructor() {
    const auth = Buffer.from(`${config.jira.email}:${config.jira.apiToken}`).toString('base64');
    
    this.client = axios.create({
      baseURL: config.jira.url,
      headers: {
        'Authorization': `Basic ${auth}`,
        'Accept': 'application/json',
        'Content-Type': 'application/json',
      },
    });
  }

  /**
   * Fetches a Jira ticket by issue key
   */
  async fetchTicket(issueKey: string): Promise<JiraTicket> {
    try {
      logger.verboseLog(`Fetching Jira ticket: ${issueKey}`);
      
      // Request description field explicitly
      const response = await this.client.get(`/rest/api/3/issue/${issueKey}?fields=summary,description`);
      const issue = response.data;

      // Extract description - handle both HTML and plain text
      let description = '';
      if (issue.fields.description) {
        if (typeof issue.fields.description === 'string') {
          description = issue.fields.description;
        } else if (issue.fields.description.content) {
          // Handle ADF (Atlassian Document Format)
          description = this.extractTextFromADF(issue.fields.description);
        } else if (issue.fields.description.type === 'doc') {
          // Alternative ADF structure
          description = this.extractTextFromADF(issue.fields.description);
        }
      }
      
      logger.verboseLog(`Extracted description type: ${typeof issue.fields.description}, has content: ${!!issue.fields.description?.content}`);

      const ticket: JiraTicket = {
        key: issue.key,
        summary: issue.fields.summary || '',
        description: description,
        url: `${config.jira.url}/browse/${issue.key}`,
      };

      logger.verboseLog(`Successfully fetched ticket: ${ticket.key}`);
      return ticket;
    } catch (error: any) {
      if (error.response) {
        // Check for authentication errors first (some Jira instances return 404 for auth failures)
        const status = error.response.status;
        const responseData = error.response.data || {};
        const errorMessage = responseData.errorMessages?.[0] || 
                           responseData.message || 
                           error.response.statusText || 
                           '';
        const errorText = errorMessage.toLowerCase();
        
        // Log full error response in verbose mode for debugging
        logger.verboseLog(`Jira API Error Response: Status ${status}, Data: ${JSON.stringify(responseData)}`);
        
        // Check if it's actually an authentication error
        // Some Jira instances return 404 with empty body for auth failures
        const isEmptyResponse = !responseData || 
                               (Object.keys(responseData).length === 0 && status === 404);
        
        // Check for explicit permission denial (more specific than just "permission")
        const hasExplicitPermissionDenial = errorText.includes('you do not have permission') ||
                                           errorText.includes('do not have permission to');
        
        // Check for other authentication-related keywords
        const hasAuthKeywords = errorText.includes('authentication') || 
                              errorText.includes('unauthorized') || 
                              errorText.includes('forbidden') ||
                              errorText.includes('credentials') ||
                              errorText.includes('login') ||
                              errorText.includes('basic auth');
        
        // Check if message mentions "does not exist" (ambiguous case)
        const mentionsDoesNotExist = errorText.includes('does not exist');
        
        // Check if message mentions permission-related terms
        const mentionsPermission = errorText.includes('permission');
        
        // Only treat as auth error if:
        // 1. Status is 401/403, OR
        // 2. Has explicit auth keywords, OR  
        // 3. Has explicit permission denial (even if "does not exist" is mentioned - ambiguous message)
        //    When Jira returns "does not exist or you do not have permission", it's often an auth issue
        const isAuthError = status === 401 || 
                           status === 403 || 
                           hasAuthKeywords ||
                           hasExplicitPermissionDenial;
        
        // Check if this is an unambiguous authentication error (401/403 or explicit auth keywords)
        const isUnambiguousAuthError = status === 401 || 
                                      status === 403 || 
                                      hasAuthKeywords;
        
        if (isUnambiguousAuthError) {
          throw new Error(
            `Authentication failed. Please check your Jira credentials (JIRA_EMAIL, JIRA_API_TOKEN).`
          );
        }
        
        // If we get 404 with empty/minimal response, it might be an auth failure
        // Check if we have valid credentials format (basic heuristic)
        if (status === 404 && isEmptyResponse) {
          logger.verboseLog('Received 404 with empty response - might indicate authentication failure');
          // We'll still throw 404, but user can check verbose logs
        }
        
        if (status === 404) {
          // Check if message is ambiguous (mentions both "does not exist" and "permission")
          if (hasExplicitPermissionDenial && mentionsDoesNotExist) {
            // Ambiguous case - could be wrong credentials OR ticket doesn't exist
            throw new Error(
              `Jira ticket "${issueKey}" not found or you do not have permission to access it. ` +
              `Please check: (1) the ticket key is correct, (2) your Jira credentials (JIRA_EMAIL, JIRA_API_TOKEN) are correct.`
            );
          } else if (hasExplicitPermissionDenial) {
            // Only permission mentioned - likely auth issue
            throw new Error(
              `Authentication failed. Please check your Jira credentials (JIRA_EMAIL, JIRA_API_TOKEN).`
            );
          } else {
            // Only "does not exist" - ticket not found
            throw new Error(`Jira ticket "${issueKey}" not found. Please check the ticket key.`);
          }
        }
        
        throw new Error(
          `Failed to fetch Jira ticket: ${status} ${error.response.statusText}`
        );
      }
      if (error.request) {
        throw new Error(
          `Network error: Could not reach Jira at ${config.jira.url}. Please check your connection and JIRA_URL.`
        );
      }
      throw new Error(`Error fetching Jira ticket: ${error.message}`);
    }
  }

  /**
   * Extracts plain text from Atlassian Document Format (ADF)
   */
  private extractTextFromADF(adf: any): string {
    if (!adf || !adf.content) {
      return '';
    }

    const extractText = (node: any, isParagraph: boolean = false): string => {
      if (node.type === 'text') {
        return node.text || '';
      }
      if (node.type === 'paragraph' || node.type === 'heading') {
        // Paragraphs should be separated by newlines
        if (node.content && Array.isArray(node.content)) {
          const text = node.content.map((child: any) => extractText(child)).join('');
          return text + '\n';
        }
        return '\n';
      }
      if (node.type === 'hardBreak') {
        return '\n';
      }
      if (node.content && Array.isArray(node.content)) {
        return node.content.map((child: any) => extractText(child)).join('');
      }
      return '';
    };

    const result = adf.content.map((node: any) => extractText(node)).join('');
    // Clean up multiple consecutive newlines but preserve at least one
    return result.replace(/\n{3,}/g, '\n\n').trim();
  }
}

