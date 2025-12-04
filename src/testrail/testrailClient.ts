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

export interface TestRailSuite {
  id: number;
  name: string;
  description?: string;
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

  /**
   * Gets all suites in a project
   */
  async getSuites(projectId: number): Promise<TestRailSuite[]> {
    try {
      logger.verboseLog(`Fetching suites for project ${projectId}`);
      
      const response = await this.client.get(
        `/index.php?/api/v2/get_suites/${projectId}`
      );
      
      // Log raw response for debugging
      logger.verboseLog(`Raw API response type: ${typeof response.data}, isArray: ${Array.isArray(response.data)}`);
      if (response.data && typeof response.data === 'object') {
        logger.verboseLog(`Response keys: ${Object.keys(response.data).join(', ')}`);
      }
      
      // Handle different response formats
      let suites: TestRailSuite[] = [];
      if (Array.isArray(response.data)) {
        suites = response.data;
      } else if (response.data && Array.isArray(response.data.suites)) {
        suites = response.data.suites;
      } else if (response.data && typeof response.data === 'object') {
        // Try to find suites array in response
        const possibleSuites = Object.values(response.data).find((val: any) => Array.isArray(val));
        if (possibleSuites) {
          suites = possibleSuites as TestRailSuite[];
        }
      }
      
      logger.verboseLog(`Found ${suites.length} suite(s) in project`);
      if (suites.length > 0) {
        logger.verboseLog(`Suite names: ${suites.map(s => `"${s.name}"`).join(', ')}`);
      }
      
      return suites;
    } catch (error: any) {
      if (error.response) {
        if (error.response.status === 401 || error.response.status === 403) {
          throw new Error(
            `TestRail authentication failed. Please check your credentials (TESTRAIL_USERNAME, TESTRAIL_API_KEY).`
          );
        }
        if (error.response.status === 400) {
          throw new Error(
            `Invalid request. Please check project ID (${projectId}).`
          );
        }
        throw new Error(
          `Failed to fetch suites: ${error.response.status} ${error.response.statusText}`
        );
      }
      if (error.request) {
        throw new Error(
          `Network error: Could not reach TestRail at ${config.testrail.url}. Please check your connection and TESTRAIL_URL.`
        );
      }
      throw new Error(`Error fetching suites: ${error.message}`);
    }
  }

  /**
   * Finds a suite by name (case-insensitive, handles whitespace normalization)
   */
  async findSuiteByName(projectId: number, suiteName: string): Promise<TestRailSuite | null> {
    try {
      const suites = await this.getSuites(projectId);
      // Normalize: lowercase, trim, and replace multiple spaces with single space
      const normalizedName = suiteName.toLowerCase().trim().replace(/\s+/g, ' ');
      
      logger.verboseLog(`Searching for suite: "${suiteName}" (normalized: "${normalizedName}")`);
      logger.verboseLog(`Found ${suites.length} suite(s) in project ${projectId}`);
      
      // Log all suite names for debugging
      suites.forEach((suite: TestRailSuite) => {
        const suiteNormalized = suite.name.toLowerCase().trim().replace(/\s+/g, ' ');
        const matches = suiteNormalized === normalizedName;
        logger.verboseLog(`  - "${suite.name}" (ID: ${suite.id}) [normalized: "${suiteNormalized}"] ${matches ? '✓ MATCH' : ''}`);
      });
      
      const foundSuite = suites.find((suite: TestRailSuite) => {
        const suiteNormalized = suite.name.toLowerCase().trim().replace(/\s+/g, ' ');
        return suiteNormalized === normalizedName;
      });
      
      if (!foundSuite) {
        logger.verboseLog(`No exact match found for "${suiteName}"`);
        // Try fuzzy matching - check if any suite name contains the search term
        const fuzzyMatches = suites.filter((suite: TestRailSuite) => {
          const suiteNormalized = suite.name.toLowerCase().trim().replace(/\s+/g, ' ');
          return suiteNormalized.includes(normalizedName) || normalizedName.includes(suiteNormalized);
        });
        if (fuzzyMatches.length > 0) {
          logger.verboseLog(`Found ${fuzzyMatches.length} potential fuzzy match(es):`);
          fuzzyMatches.forEach((suite: TestRailSuite) => {
            logger.verboseLog(`  - "${suite.name}" (ID: ${suite.id})`);
          });
        }
      }
      
      return foundSuite || null;
    } catch (error: any) {
      logger.verboseLog(`Error finding suite by name: ${error.message}`);
      throw error;
    }
  }

  /**
   * Creates a new suite in TestRail
   */
  async createSuite(projectId: number, suiteName: string, description?: string): Promise<TestRailSuite> {
    try {
      logger.verboseLog(`Creating suite: "${suiteName}" in project ${projectId}`);
      
      const payload: any = {
        name: suiteName,
      };
      
      if (description) {
        payload.description = description;
      }

      const response = await this.client.post(
        `/index.php?/api/v2/add_suite/${projectId}`,
        payload
      );

      logger.verboseLog(`Successfully created suite with ID: ${response.data.id}`);
      logger.success(`Created suite "${suiteName}" (ID: ${response.data.id})`);
      return response.data;
    } catch (error: any) {
      if (error.response) {
        const status = error.response.status;
        const errorData = error.response.data || {};
        const errorMsg = errorData.error || errorData.message || '';
        const errorDetails = errorData ? JSON.stringify(errorData, null, 2) : '';
        
        logger.verboseLog(`TestRail API Error Response: Status ${status}, Data: ${errorDetails}`);
        
        if (status === 401) {
          throw new Error(
            `TestRail authentication failed (401). Please check your credentials (TESTRAIL_USERNAME, TESTRAIL_API_KEY).`
          );
        }
        if (status === 403) {
          // Check for single suite mode error
          const isSingleSuiteMode = errorMsg.toLowerCase().includes('single test suite') || 
                                    errorMsg.toLowerCase().includes('only supports a single');
          
          if (isSingleSuiteMode) {
            // Try to get existing suites to suggest them
            let suiteSuggestions = '';
            try {
              const existingSuites = await this.getSuites(projectId);
              // In Single Suite Mode, the master suite has the lowest ID
              // Baselines are created later and will have higher IDs
              // So we should suggest the suite with the lowest ID
              if (existingSuites.length > 0) {
                // Sort by ID and get the one with lowest ID (the master suite)
                const masterSuite = existingSuites.sort((a, b) => a.id - b.id)[0];
                suiteSuggestions = `\n\nAvailable suite in this project:\n` +
                  `  - "${masterSuite.name}" (ID: ${masterSuite.id})\n` +
                  `\n\nUse the existing suite instead. For example:\n` +
                  `  --suite-name "${masterSuite.name}"\n` +
                  `  or\n` +
                  `  --suite-id ${masterSuite.id}`;
              }
            } catch (e) {
              // If we can't fetch suites, just continue without suggestions
              logger.verboseLog(`Could not fetch suites for suggestions: ${e}`);
            }
            
            throw new Error(
              `This TestRail project is configured in "Single Suite Mode" and only allows one test suite.\n` +
              `You cannot create additional suites in this project.\n` +
              `Instead, use the existing suite and create sections within it.${suiteSuggestions}`
            );
          }
          
          // 403 for other reasons (permission denied)
          const permissionMsg = errorMsg.toLowerCase().includes('permission') || errorMsg.toLowerCase().includes('not allowed')
            ? `\nError details: ${errorMsg}`
            : '';
          throw new Error(
            `TestRail permission denied (403). You may not have permission to create suites in project ${projectId}.${permissionMsg}\n` +
            `Please check:\n` +
            `1. Your TestRail user has "Project Lead" or "Administrator" role\n` +
            `2. You have "Add/Edit Test Cases" permission for this project\n` +
            `3. The project allows suite creation (some projects may be locked)`
          );
        }
        if (status === 400) {
          throw new Error(`Failed to create suite: ${errorMsg || 'Invalid request'}\nDetails: ${errorDetails}`);
        }
        throw new Error(
          `Failed to create suite: ${status} ${error.response.statusText}\nDetails: ${errorDetails}`
        );
      }
      if (error.request) {
        throw new Error(
          `Network error: Could not reach TestRail. Please check your connection.`
        );
      }
      throw new Error(`Error creating suite: ${error.message}`);
    }
  }

  /**
   * Creates a new section in TestRail
   */
  async createSection(
    projectId: number,
    suiteId: number,
    sectionName: string,
    parentId?: number
  ): Promise<TestRailSection> {
    try {
      const parentInfo = parentId ? ` under parent section ${parentId}` : '';
      logger.verboseLog(`Creating section: "${sectionName}" in suite ${suiteId}${parentInfo}`);
      
      const payload: any = {
        name: sectionName,
        suite_id: suiteId,
      };
      
      if (parentId) {
        payload.parent_id = parentId;
      }

      const response = await this.client.post(
        `/index.php?/api/v2/add_section/${projectId}`,
        payload
      );

      logger.verboseLog(`Successfully created section with ID: ${response.data.id}`);
      logger.success(`Created section "${sectionName}" (ID: ${response.data.id})`);
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
          throw new Error(`Failed to create section: ${errorMsg}\nDetails: ${errorDetails}`);
        }
        throw new Error(
          `Failed to create section: ${error.response.status} ${error.response.statusText}`
        );
      }
      if (error.request) {
        throw new Error(
          `Network error: Could not reach TestRail. Please check your connection.`
        );
      }
      throw new Error(`Error creating section: ${error.message}`);
    }
  }

  /**
   * Deletes a suite from TestRail
   */
  async deleteSuite(suiteId: number): Promise<void> {
    try {
      logger.verboseLog(`Deleting suite ID ${suiteId}`);
      
      await this.client.post(
        `/index.php?/api/v2/delete_suite/${suiteId}`,
        {}
      );

      logger.verboseLog(`Successfully deleted suite ID ${suiteId}`);
      logger.success(`Deleted suite ID ${suiteId}`);
    } catch (error: any) {
      if (error.response) {
        const status = error.response.status;
        const errorData = error.response.data || {};
        const errorMsg = errorData.error || errorData.message || '';
        const errorDetails = errorData ? JSON.stringify(errorData, null, 2) : '';
        
        logger.verboseLog(`TestRail API Error Response: Status ${status}, Data: ${errorDetails}`);
        
        if (status === 401) {
          throw new Error(
            `TestRail authentication failed (401). Please check your credentials (TESTRAIL_USERNAME, TESTRAIL_API_KEY).`
          );
        }
        if (status === 403) {
          // Check for Single Suite Mode restriction or master suite restriction
          const isSingleSuiteMode = errorMsg.toLowerCase().includes('single') || 
                                    errorMsg.toLowerCase().includes('not permitted') ||
                                    errorMsg.toLowerCase().includes('not allowed') ||
                                    errorMsg.toLowerCase().includes('master suite') ||
                                    errorMsg.toLowerCase().includes('cannot be deleted');
          
          if (isSingleSuiteMode) {
            throw new Error(
              `Cannot delete suite in Single Suite Mode.\n` +
              `TestRail projects configured in "Single Suite Mode" do not allow suite deletion.\n` +
              `The master suite cannot be deleted in this project type.\n\n` +
              `If you need to delete suites, you must:\n` +
              `1. Change the project to "Multiple Test Suites" mode in TestRail UI\n` +
              `2. Or use TestRail UI to manage test cases and sections instead\n\n` +
              `Error details: ${errorMsg || 'Suite deletion not permitted'}`
            );
          }
          
          // Other 403 errors (permission denied)
          throw new Error(
            `TestRail permission denied (403). You may not have permission to delete suites.\n` +
            `Please check:\n` +
            `1. Your TestRail user has "Project Lead" or "Administrator" role\n` +
            `2. You have permission to delete suites in this project\n` +
            `3. The suite is not locked or in use\n\n` +
            `Error details: ${errorMsg || 'Permission denied'}`
          );
        }
        if (status === 400) {
          const errorMsg = errorData.error || 'Invalid request';
          throw new Error(`Failed to delete suite: ${errorMsg}\nDetails: ${errorDetails}`);
        }
        if (status === 404) {
          throw new Error(`Suite with ID ${suiteId} not found.`);
        }
        throw new Error(
          `Failed to delete suite: ${status} ${error.response.statusText}\nDetails: ${errorDetails}`
        );
      }
      if (error.request) {
        throw new Error(
          `Network error: Could not reach TestRail. Please check your connection.`
        );
      }
      throw new Error(`Error deleting suite: ${error.message}`);
    }
  }
}

