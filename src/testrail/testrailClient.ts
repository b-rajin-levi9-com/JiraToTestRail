import axios, { AxiosInstance } from 'axios';
import { config } from '../utils/config';
import { logger } from '../utils/logger';

export interface TestRailTestCase {
  id?: number;
  title: string;
  section_id: number;
  template_id?: number;
  type_id?: number;
  priority_id?: number;
  preconds?: string;
  steps?: TestRailStep[];
  expected?: string;
  refs?: string;
}

export interface TestRailStep {
  content: string;
  expected: string;
}

export interface TestRailTestCaseResponse {
  id: number;
  title: string;
  section_id: number;
  [key: string]: any;
}

export interface TestRailSection {
  id: number;
  name: string;
  suite_id: number;
  parent_id?: number;
  [key: string]: any;
}

export class TestRailClient {
  private client: AxiosInstance;
  private customFieldsCache: Map<string, any> | null = null;

  constructor() {
    const auth = Buffer.from(`${config.testrail.username}:${config.testrail.apiKey}`).toString('base64');
    
    this.client = axios.create({
      baseURL: config.testrail.url,
      headers: {
        'Authorization': `Basic ${auth}`,
        'Content-Type': 'application/json',
      },
    });
  }

  /**
   * Gets all test cases in a section
   */
  async getTestCases(projectId: number, sectionId: number, suiteId?: number): Promise<TestRailTestCaseResponse[]> {
    try {
      logger.verboseLog(`Fetching test cases for project ${projectId}, section ${sectionId}${suiteId ? `, suite ${suiteId}` : ''}`);
      
      // Build URL with optional suite_id parameter
      let url = `/index.php?/api/v2/get_cases/${projectId}&section_id=${sectionId}`;
      if (suiteId) {
        url += `&suite_id=${suiteId}`;
      }
      
      const response = await this.client.get(url);
      
      // TestRail API may return paginated response with cases array
      const cases = response.data?.cases || (Array.isArray(response.data) ? response.data : []);
      
      if (!Array.isArray(cases)) {
        logger.verboseLog(`Unexpected response structure: ${JSON.stringify(response.data)}`);
        throw new Error(`Invalid response format from TestRail API. Expected cases array.`);
      }
      
      logger.verboseLog(`Found ${cases.length} existing test cases`);
      return cases;
    } catch (error: any) {
      if (error.response) {
        if (error.response.status === 401 || error.response.status === 403) {
          throw new Error(
            `TestRail authentication failed. Please check your credentials (TESTRAIL_USERNAME, TESTRAIL_API_KEY).`
          );
        }
        if (error.response.status === 400) {
          throw new Error(
            `Invalid request. Please check project ID (${projectId}) and section ID (${sectionId}).`
          );
        }
        throw new Error(
          `Failed to fetch test cases: ${error.response.status} ${error.response.statusText}`
        );
      }
      if (error.request) {
        throw new Error(
          `Network error: Could not reach TestRail at ${config.testrail.url}. Please check your connection and TESTRAIL_URL.`
        );
      }
      throw new Error(`Error fetching test cases: ${error.message}`);
    }
  }

  /**
   * Gets custom field configuration from TestRail
   */
  async getCaseFields(): Promise<any[]> {
    try {
      logger.verboseLog('Fetching custom case fields from TestRail');
      const response = await this.client.get('/index.php?/api/v2/get_case_fields');
      return response.data || [];
    } catch (error: any) {
      logger.verboseLog(`Could not fetch custom fields: ${error.message}`);
      return [];
    }
  }

  /**
   * Gets all sections in a suite
   */
  async getSections(projectId: number, suiteId: number): Promise<TestRailSection[]> {
    try {
      logger.verboseLog(`Fetching sections for project ${projectId}, suite ${suiteId}`);
      
      const response = await this.client.get(
        `/index.php?/api/v2/get_sections/${projectId}&suite_id=${suiteId}`
      );
      
      // TestRail API returns paginated response with sections array
      const sections = response.data?.sections || (Array.isArray(response.data) ? response.data : []);
      logger.verboseLog(`Found ${sections.length} sections in suite`);
      
      if (!Array.isArray(sections)) {
        logger.verboseLog(`Unexpected response structure: ${JSON.stringify(response.data)}`);
        throw new Error(`Invalid response format from TestRail API. Expected sections array.`);
      }
      
      return sections;
    } catch (error: any) {
      if (error.response) {
        if (error.response.status === 401 || error.response.status === 403) {
          throw new Error(
            `TestRail authentication failed. Please check your credentials (TESTRAIL_USERNAME, TESTRAIL_API_KEY).`
          );
        }
        if (error.response.status === 400) {
          throw new Error(
            `Invalid request. Please check project ID (${projectId}) and suite ID (${suiteId}).`
          );
        }
        throw new Error(
          `Failed to fetch sections: ${error.response.status} ${error.response.statusText}`
        );
      }
      if (error.request) {
        throw new Error(
          `Network error: Could not reach TestRail at ${config.testrail.url}. Please check your connection and TESTRAIL_URL.`
        );
      }
      throw new Error(`Error fetching sections: ${error.message}`);
    }
  }

  /**
   * Gets a single section by ID
   */
  async getSection(sectionId: number): Promise<TestRailSection> {
    try {
      logger.verboseLog(`Fetching section ${sectionId}`);
      
      const response = await this.client.get(
        `/index.php?/api/v2/get_section/${sectionId}`
      );
      
      return response.data;
    } catch (error: any) {
      if (error.response) {
        if (error.response.status === 401 || error.response.status === 403) {
          throw new Error(
            `TestRail authentication failed. Please check your credentials.`
          );
        }
        if (error.response.status === 404) {
          throw new Error(`Section with ID ${sectionId} not found.`);
        }
        throw new Error(
          `Failed to fetch section: ${error.response.status} ${error.response.statusText}`
        );
      }
      if (error.request) {
        throw new Error(
          `Network error: Could not reach TestRail. Please check your connection.`
        );
      }
      throw new Error(`Error fetching section: ${error.message}`);
    }
  }

  /**
   * Creates a new test case in TestRail
   */
  async createTestCase(sectionId: number, testCase: TestRailTestCase): Promise<TestRailTestCaseResponse> {
    try {
      logger.verboseLog(`Creating test case: "${testCase.title}" in section ${sectionId}`);
      
      // Fetch custom fields if not cached
      if (!this.customFieldsCache) {
        const fields = await this.getCaseFields();
        this.customFieldsCache = new Map();
        fields.forEach((field: any) => {
          this.customFieldsCache!.set(field.system_name, field);
        });
        logger.verboseLog(`Found ${fields.length} custom fields`);
        // Log custom field names for debugging
        fields.forEach((field: any) => {
          logger.verboseLog(`  - ${field.system_name} (${field.name}): type_id=${field.type_id}`);
        });
      }

      const payload: any = {
        title: testCase.title,
        section_id: sectionId,
      };

      // TestRail requires template_id for test cases with steps
      // Template 1 = Steps, Template 2 = Text, Template 3 = Exploratory Session
      if (testCase.steps && testCase.steps.length > 0) {
        payload.template_id = 1; // Steps template
      } else {
        payload.template_id = 2; // Text template
      }

      // Use standard TestRail API fields
      if (testCase.preconds) {
        payload.preconds = testCase.preconds;
        // Also try custom field if it exists
        const precondsField = this.customFieldsCache.get('custom_preconds');
        if (precondsField) {
          payload[precondsField.system_name] = testCase.preconds;
        }
      }

      if (testCase.steps && testCase.steps.length > 0) {
        // Format steps for TestRail API
        // TestRail expects steps as an array of objects with 'content' and 'expected'
        const formattedSteps = testCase.steps.map((step, index) => ({
          content: step.content,
          expected: step.expected || '',
        }));
        payload.steps = formattedSteps;
        logger.verboseLog(`Adding ${payload.steps.length} steps to test case`);
        
        // Try to find and set custom steps field
        // TestRail might use custom_steps_separated or a different format
        const stepsField = this.customFieldsCache.get('custom_steps');
        const stepsSeparatedField = this.customFieldsCache.get('custom_steps_separated');
        
        if (stepsField) {
          // Format steps based on field type
          if (stepsField.type_id === 10) {
            // Type 10 is Steps field - use array format
            payload[stepsField.system_name] = formattedSteps;
          } else {
            // Other types might need string format
            const stepsText = formattedSteps.map((s, i) => 
              `${i + 1}. ${s.content}${s.expected ? `\n   Expected: ${s.expected}` : ''}`
            ).join('\n\n');
            payload[stepsField.system_name] = stepsText;
          }
        }
        
        if (stepsSeparatedField) {
          // custom_steps_separated might need the array format
          payload[stepsSeparatedField.system_name] = formattedSteps;
        }
        
        // Also try setting custom_steps directly (might work for some TestRail instances)
        if (!stepsField && !stepsSeparatedField) {
          payload.custom_steps = formattedSteps;
          payload.custom_steps_separated = formattedSteps;
        }
      }
      
      if (testCase.expected) {
        payload.expected = testCase.expected;
        // Also try custom field if it exists
        const expectedField = this.customFieldsCache.get('custom_expected');
        if (expectedField) {
          payload[expectedField.system_name] = testCase.expected;
        }
      }

      if (testCase.refs) {
        payload.refs = testCase.refs;
      }

      logger.verboseLog(`Payload: ${JSON.stringify(payload, null, 2)}`);

      const response = await this.client.post(
        `/index.php?/api/v2/add_case/${sectionId}`,
        payload
      );

      logger.verboseLog(`TestRail Response: ${JSON.stringify(response.data, null, 2)}`);
      logger.verboseLog(`Successfully created test case with ID: ${response.data.id}`);
      return response.data;
    } catch (error: any) {
      if (error.response) {
        if (error.response.status === 401 || error.response.status === 403) {
          throw new Error(
            `TestRail authentication failed. Please check your credentials.`
          );
        }
        if (error.response.status === 400) {
          const errorMsg = error.response.data?.error || 'Invalid request';
          const errorDetails = error.response.data ? JSON.stringify(error.response.data, null, 2) : '';
          logger.verboseLog(`TestRail API Error Response: ${errorDetails}`);
          throw new Error(`Failed to create test case: ${errorMsg}\nDetails: ${errorDetails}`);
        }
        throw new Error(
          `Failed to create test case: ${error.response.status} ${error.response.statusText}`
        );
      }
      if (error.request) {
        throw new Error(
          `Network error: Could not reach TestRail. Please check your connection.`
        );
      }
      throw new Error(`Error creating test case: ${error.message}`);
    }
  }

  /**
   * Updates an existing test case in TestRail
   */
  async updateTestCase(caseId: number, testCase: Partial<TestRailTestCase>): Promise<TestRailTestCaseResponse> {
    try {
      logger.verboseLog(`Updating test case ID ${caseId}`);
      
      // Fetch custom fields if not cached
      if (!this.customFieldsCache) {
        const fields = await this.getCaseFields();
        this.customFieldsCache = new Map();
        fields.forEach((field: any) => {
          this.customFieldsCache!.set(field.system_name, field);
        });
        logger.verboseLog(`Found ${fields.length} custom fields`);
        fields.forEach((field: any) => {
          logger.verboseLog(`  - ${field.system_name} (${field.name}): type_id=${field.type_id}`);
        });
      }
      
      const payload: any = {};

      if (testCase.title) {
        payload.title = testCase.title;
      }
      
      // Set template_id if steps are provided
      if (testCase.steps && testCase.steps.length > 0) {
        payload.template_id = 1; // Steps template
      }
      
      // Use standard TestRail API fields for updates
      if (testCase.preconds !== undefined) {
        payload.preconds = testCase.preconds;
        // Also set custom field
        const precondsField = this.customFieldsCache.get('custom_preconds');
        if (precondsField) {
          payload[precondsField.system_name] = testCase.preconds;
        }
      }
      
      if (testCase.steps && testCase.steps.length > 0) {
        const formattedSteps = testCase.steps.map((step) => ({
          content: step.content,
          expected: step.expected || '',
        }));
        payload.steps = formattedSteps;
        logger.verboseLog(`Updating with ${payload.steps.length} steps`);
        
        // Try to find and set custom steps field
        const stepsField = this.customFieldsCache.get('custom_steps');
        const stepsSeparatedField = this.customFieldsCache.get('custom_steps_separated');
        
        if (stepsField) {
          if (stepsField.type_id === 10) {
            // Type 10 is Steps field - use array format
            payload[stepsField.system_name] = formattedSteps;
          } else {
            // Other types might need string format
            const stepsText = formattedSteps.map((s, i) => 
              `${i + 1}. ${s.content}${s.expected ? `\n   Expected: ${s.expected}` : ''}`
            ).join('\n\n');
            payload[stepsField.system_name] = stepsText;
          }
        }
        
        if (stepsSeparatedField) {
          payload[stepsSeparatedField.system_name] = formattedSteps;
        }
      }
      
      if (testCase.expected !== undefined) {
        payload.expected = testCase.expected;
        // Also set custom field
        const expectedField = this.customFieldsCache.get('custom_expected');
        if (expectedField) {
          payload[expectedField.system_name] = testCase.expected;
        }
      }
      
      if (testCase.refs !== undefined) {
        payload.refs = testCase.refs;
      }
      
      logger.verboseLog(`Update Payload: ${JSON.stringify(payload, null, 2)}`);

      const response = await this.client.post(
        `/index.php?/api/v2/update_case/${caseId}`,
        payload
      );

      logger.verboseLog(`Successfully updated test case ID ${caseId}`);
      return response.data;
    } catch (error: any) {
      if (error.response) {
        if (error.response.status === 401 || error.response.status === 403) {
          throw new Error(
            `TestRail authentication failed. Please check your credentials.`
          );
        }
        if (error.response.status === 400) {
          const errorMsg = error.response.data?.error || 'Invalid request';
          const errorDetails = error.response.data ? JSON.stringify(error.response.data, null, 2) : '';
          logger.error(`TestRail API Error Response: ${errorDetails}`);
          throw new Error(`Failed to update test case: ${errorMsg}\nDetails: ${errorDetails}`);
        }
        if (error.response.status === 404) {
          throw new Error(`Test case with ID ${caseId} not found.`);
        }
        throw new Error(
          `Failed to update test case: ${error.response.status} ${error.response.statusText}`
        );
      }
      if (error.request) {
        throw new Error(
          `Network error: Could not reach TestRail. Please check your connection.`
        );
      }
      throw new Error(`Error updating test case: ${error.message}`);
    }
  }

  /**
   * Deletes a test case from TestRail
   */
  async deleteTestCase(caseId: number): Promise<void> {
    try {
      logger.verboseLog(`Deleting test case ID ${caseId}`);
      
      await this.client.post(
        `/index.php?/api/v2/delete_case/${caseId}`,
        {}
      );

      logger.verboseLog(`Successfully deleted test case ID ${caseId}`);
    } catch (error: any) {
      if (error.response) {
        if (error.response.status === 401 || error.response.status === 403) {
          throw new Error(
            `TestRail authentication failed. Please check your credentials.`
          );
        }
        if (error.response.status === 400) {
          const errorMsg = error.response.data?.error || 'Invalid request';
          throw new Error(`Failed to delete test case: ${errorMsg}`);
        }
        if (error.response.status === 404) {
          throw new Error(`Test case with ID ${caseId} not found.`);
        }
        throw new Error(
          `Failed to delete test case: ${error.response.status} ${error.response.statusText}`
        );
      }
      if (error.request) {
        throw new Error(
          `Network error: Could not reach TestRail. Please check your connection.`
        );
      }
      throw new Error(`Error deleting test case: ${error.message}`);
    }
  }
}

