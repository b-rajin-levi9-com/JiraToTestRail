import { JiraClient, JiraTicket } from '../jira/jiraClient';
import { GherkinParser, ParsedScenario } from '../parser/gherkinParser';
import { TestRailClient, TestRailTestCase, TestRailTestCaseResponse, TestRailSection } from '../testrail/testrailClient';
import { logger } from '../utils/logger';
import { config } from '../utils/config';

export interface SyncResult {
  jiraTicket: JiraTicket;
  scenariosFound: number;
  scenariosCreated: number;
  scenariosUpdated: number;
  scenariosDeleted: number;
  scenariosSkipped: number;
  testCaseIds: number[];
  errors: string[];
}

export class SyncService {
  private jiraClient: JiraClient;
  private gherkinParser: GherkinParser;
  private testrailClient: TestRailClient;

  constructor() {
    this.jiraClient = new JiraClient();
    this.gherkinParser = new GherkinParser();
    this.testrailClient = new TestRailClient();
  }

  /**
   * Syncs Gherkin scenarios from a Jira ticket to TestRail test cases
   */
  async syncTicketToTestRail(
    jiraKey: string,
    testrailProjectId: number,
    testrailSuiteId?: number,
    testrailSectionId?: number,
    sectionName?: string,
    dryRun: boolean = false
  ): Promise<SyncResult> {
    const result: SyncResult = {
      jiraTicket: {} as JiraTicket,
      scenariosFound: 0,
      scenariosCreated: 0,
      scenariosUpdated: 0,
      scenariosDeleted: 0,
      scenariosSkipped: 0,
      testCaseIds: [],
      errors: [],
    };

    try {
      // Resolve section ID from suite ID if needed
      let sectionId: number;
      if (testrailSuiteId) {
        logger.info(`Fetching sections from suite ${testrailSuiteId}...`);
        const sections = await this.testrailClient.getSections(testrailProjectId, testrailSuiteId);
        
        // Ensure sections is an array
        if (!Array.isArray(sections)) {
          logger.verboseLog(`Unexpected response type: ${typeof sections}, value: ${JSON.stringify(sections)}`);
          throw new Error(`Invalid response from TestRail API. Expected array of sections, got ${typeof sections}.`);
        }
        
        if (sections.length === 0) {
          throw new Error(`No sections found in suite ${testrailSuiteId}. Please create a section first.`);
        }
        
        // Find section by name if provided, otherwise use first section
        let selectedSection;
        if (sectionName) {
          const normalizedName = sectionName.toLowerCase().trim();
          
          // Check if section name contains a path separator (for subsections)
          const nameParts = normalizedName.split('/').map(part => part.trim()).filter(part => part.length > 0);
          
          if (nameParts.length === 1) {
            // Simple section name - find top-level section first
            selectedSection = sections.find((s: TestRailSection) => 
              s.name.toLowerCase().trim() === normalizedName && !s.parent_id
            );
            
            if (!selectedSection) {
              // Also check subsections if not found in top-level
              selectedSection = sections.find((s: TestRailSection) => 
                s.name.toLowerCase().trim() === normalizedName
              );
            }
          } else {
            // Hierarchical path: "Parent/Subsection/Sub-subsection/..."
            // Traverse the hierarchy recursively
            let currentParentId: number | null = null;
            const pathTraversed: string[] = [];
            
            for (let i = 0; i < nameParts.length; i++) {
              const partName = nameParts[i];
              const foundSection = sections.find((s: TestRailSection) => 
                s.name.toLowerCase().trim() === partName && 
                (currentParentId === null ? !s.parent_id : s.parent_id === currentParentId)
              );
              
              if (!foundSection) {
                // Build helpful error message
                const currentPath = nameParts.slice(0, i).join('/');
                const parentContext = currentParentId === null 
                  ? 'top-level'
                  : `under "${pathTraversed.join('/')}"`;
                
                const availableSections = sections
                  .filter(s => currentParentId === null ? !s.parent_id : s.parent_id === currentParentId)
                  .map(s => `"${s.name}" (ID: ${s.id})`)
                  .join(', ');
                
                throw new Error(
                  `Section "${partName}" not found ${parentContext} in suite ${testrailSuiteId}.\n` +
                  `Path: ${currentPath ? currentPath + '/' : ''}${partName}\n` +
                  `Available sections ${parentContext}: ${availableSections || 'None'}`
                );
              }
              
              pathTraversed.push(foundSection.name);
              currentParentId = foundSection.id;
              
              // If this is the last part, this is our target section
              if (i === nameParts.length - 1) {
                selectedSection = foundSection;
              }
            }
            
            // Log the full path that was traversed
            if (selectedSection && pathTraversed.length > 1) {
              logger.success(
                `Found section "${selectedSection.name}" (ID: ${selectedSection.id}) ` +
                `at path: "${pathTraversed.join('/')}"`
              );
            }
          }
          
          if (!selectedSection) {
            const availableSections = sections.map(s => {
              const parentInfo = s.parent_id 
                ? ` (under section ID ${s.parent_id})` 
                : '';
              return `"${s.name}" (ID: ${s.id})${parentInfo}`;
            }).join(', ');
            throw new Error(
              `Section "${sectionName}" not found in suite ${testrailSuiteId}.\n` +
              `Available sections: ${availableSections}`
            );
          }
          
          if (!selectedSection.parent_id) {
            logger.success(`Found section "${selectedSection.name}" (ID: ${selectedSection.id})`);
          }
        } else {
          // Use first top-level section (no parent_id)
          selectedSection = sections.find((s: TestRailSection) => !s.parent_id) || sections[0];
          
          if (selectedSection?.parent_id) {
            logger.warning(`Using subsection "${selectedSection.name}" (ID: ${selectedSection.id})`);
          } else {
            logger.success(`Using first section "${selectedSection.name}" (ID: ${selectedSection.id})`);
          }
          
          if (sections.length > 1) {
            const topLevelSections = sections.filter(s => !s.parent_id);
            if (topLevelSections.length > 1) {
              logger.info(`Found ${topLevelSections.length} top-level sections in suite. Using first section.`);
              logger.verboseLog(`Available top-level sections: ${topLevelSections.map(s => `"${s.name}" (ID: ${s.id})`).join(', ')}`);
            }
            const subsections = sections.filter(s => s.parent_id);
            if (subsections.length > 0) {
              logger.verboseLog(`Found ${subsections.length} subsection(s). Use "Parent/Subsection" or "Parent/Subsection/Sub-subsection" format to select them.`);
            }
            logger.info(`Tip: Use --section-name to select a specific section or subsection.`);
          }
        }
        
        sectionId = selectedSection.id;
      } else if (testrailSectionId) {
        sectionId = testrailSectionId;
        
        // Fetch section details to get suite_id (required for subsections)
        logger.info(`Fetching section details for section ID ${sectionId}...`);
        try {
          const sectionDetails = await this.testrailClient.getSection(sectionId);
          if (sectionDetails.suite_id) {
            testrailSuiteId = sectionDetails.suite_id;
            logger.verboseLog(`Section ${sectionId} belongs to suite ${testrailSuiteId}`);
          }
        } catch (error: any) {
          logger.warning(`Could not fetch section details: ${error.message}. Proceeding without suite_id...`);
        }
      } else {
        throw new Error('Either suite ID or section ID must be provided');
      }

      // Step 1: Fetch Jira ticket
      logger.info(`Fetching Jira ticket: ${jiraKey}`);
      result.jiraTicket = await this.jiraClient.fetchTicket(jiraKey);
      logger.success(`Fetched ticket: ${result.jiraTicket.key} - ${result.jiraTicket.summary}`);

      // Step 2: Parse scenarios from description
      logger.info('Parsing Gherkin scenarios from ticket description...');
      logger.verboseLog(`Description length: ${result.jiraTicket.description.length} characters`);
      logger.verboseLog(`Description preview (first 500 chars): ${result.jiraTicket.description.substring(0, 500)}`);
      const scenarios = this.gherkinParser.parseScenarios(result.jiraTicket.description);
      result.scenariosFound = scenarios.length;

      if (scenarios.length === 0) {
        logger.warning('No Gherkin scenarios found in ticket description.');
        return result;
      }

      logger.success(`Found ${scenarios.length} scenario(s)`);

      // Step 3: Get existing test cases
      logger.info(`Fetching existing test cases from TestRail section ${sectionId}...`);
      const existingTestCases = await this.testrailClient.getTestCases(
        testrailProjectId,
        sectionId,
        testrailSuiteId || undefined
      );

      // Filter test cases that belong to this Jira ticket (by refs field)
      const jiraTicketTestCases = existingTestCases.filter((tc) => {
        // Check if refs field matches the Jira ticket key
        const refs = tc.refs || '';
        return refs.toString().includes(jiraKey);
      });

      logger.verboseLog(`Found ${jiraTicketTestCases.length} existing test case(s) linked to ${jiraKey}`);

      // Create a map of existing test cases by title for quick lookup
      const existingCasesMap = new Map<string, TestRailTestCaseResponse>();
      jiraTicketTestCases.forEach((tc) => {
        existingCasesMap.set(tc.title.toLowerCase().trim(), tc);
      });

      // Create a set of scenario titles from Jira for comparison
      const jiraScenarioTitles = new Set<string>();
      scenarios.forEach((scenario) => {
        jiraScenarioTitles.add(scenario.name.toLowerCase().trim());
      });

      // Step 4: Create or update test cases
      if (dryRun) {
        logger.info('DRY RUN MODE - No changes will be made');
      }

      for (const scenario of scenarios) {
        try {
          const testCaseTitle = scenario.name;
          const normalizedTitle = testCaseTitle.toLowerCase().trim();
          const existingCase = existingCasesMap.get(normalizedTitle);

          // Prepare test case data
          // Extract expected result: last "Then" and any following "And" steps
          const expectedResultParts: string[] = [];
          let lastThenIndex = -1;
          for (let i = scenario.steps.length - 1; i >= 0; i--) {
            const step = scenario.steps[i];
            if (/^then\s+/i.test(step) || /^and\s+then\s+/i.test(step)) {
              lastThenIndex = i;
              break;
            }
          }
          
          // Collect the last "Then" and all following "And" steps for expected result
          if (lastThenIndex >= 0) {
            for (let i = lastThenIndex; i < scenario.steps.length; i++) {
              expectedResultParts.push(scenario.steps[i]);
            }
          }
          
          const expectedResult = expectedResultParts.length > 0 
            ? expectedResultParts.join('\n')
            : scenario.expectedResult;

          const testCase: TestRailTestCase = {
            title: testCaseTitle,
            section_id: sectionId,
            preconds: `Jira Ticket: ${result.jiraTicket.key}\n${result.jiraTicket.url}`,
            refs: result.jiraTicket.key,
            steps: this.convertStepsToTestRailFormat(scenario),
            expected: expectedResult,
          };

          if (dryRun) {
            if (existingCase) {
              logger.verboseLog(`[DRY RUN] Would update test case: "${testCaseTitle}" (ID: ${existingCase.id})`);
              result.scenariosUpdated++;
            } else {
              logger.verboseLog(`[DRY RUN] Would create test case: "${testCaseTitle}"`);
              result.scenariosCreated++;
            }
            continue;
          }

          if (existingCase) {
            // Update existing test case
            logger.info(`Updating existing test case: "${testCaseTitle}" (ID: ${existingCase.id})`);
            const updatedCase = await this.testrailClient.updateTestCase(existingCase.id, testCase);
            result.testCaseIds.push(updatedCase.id);
            result.scenariosUpdated++;
            logger.success(`Updated test case ID ${updatedCase.id}`);
          } else {
            // Create new test case
            logger.info(`Creating new test case: "${testCaseTitle}"`);
            const newCase = await this.testrailClient.createTestCase(sectionId, testCase);
            result.testCaseIds.push(newCase.id);
            result.scenariosCreated++;
            logger.success(`Created test case ID ${newCase.id}`);
          }
        } catch (error: any) {
          const errorMsg = `Failed to sync scenario "${scenario.name}": ${error.message}`;
          logger.error(errorMsg);
          result.errors.push(errorMsg);
          result.scenariosSkipped++;
        }
      }

      // Step 5: Delete test cases that no longer exist in Jira ticket
      logger.info('Checking for deleted scenarios...');
      const testCasesToDelete: TestRailTestCaseResponse[] = [];
      
      for (const testCase of jiraTicketTestCases) {
        const normalizedTitle = testCase.title.toLowerCase().trim();
        if (!jiraScenarioTitles.has(normalizedTitle)) {
          testCasesToDelete.push(testCase);
        }
      }

      if (testCasesToDelete.length > 0) {
        logger.info(`Found ${testCasesToDelete.length} test case(s) to delete`);
        
        for (const testCase of testCasesToDelete) {
          try {
            if (dryRun) {
              logger.verboseLog(`[DRY RUN] Would delete test case: "${testCase.title}" (ID: ${testCase.id})`);
              result.scenariosDeleted++;
            } else {
              logger.info(`Deleting test case: "${testCase.title}" (ID: ${testCase.id})`);
              await this.testrailClient.deleteTestCase(testCase.id);
              result.scenariosDeleted++;
              logger.success(`Deleted test case ID ${testCase.id}`);
            }
          } catch (error: any) {
            const errorMsg = `Failed to delete test case "${testCase.title}" (ID: ${testCase.id}): ${error.message}`;
            logger.error(errorMsg);
            result.errors.push(errorMsg);
            result.scenariosSkipped++;
          }
        }
      } else {
        logger.verboseLog('No test cases to delete');
      }

      // Summary
      logger.info('\n=== Sync Summary ===');
      logger.info(`Scenarios found: ${result.scenariosFound}`);
      logger.info(`Created: ${result.scenariosCreated}`);
      logger.info(`Updated: ${result.scenariosUpdated}`);
      if (result.scenariosDeleted > 0) {
        logger.info(`Deleted: ${result.scenariosDeleted}`);
      }
      logger.info(`Skipped: ${result.scenariosSkipped}`);
      if (result.errors.length > 0) {
        logger.warning(`Errors: ${result.errors.length}`);
      }

      return result;
    } catch (error: any) {
      const errorMsg = error.message || 'Unknown error occurred';
      logger.error(`Sync failed: ${errorMsg}`);
      result.errors.push(errorMsg);
      throw error;
    }
  }

  /**
   * Converts parsed scenario steps to TestRail step format
   * Steps before the last "Then" go to Steps field
   * Last "Then" and any following "And" steps go to Expected Result field
   */
  private convertStepsToTestRailFormat(scenario: ParsedScenario): Array<{ content: string; expected: string }> {
    const steps: Array<{ content: string; expected: string }> = [];

    // Find the last "Then" step
    let lastThenIndex = -1;
    for (let i = scenario.steps.length - 1; i >= 0; i--) {
      const step = scenario.steps[i];
      if (/^then\s+/i.test(step) || /^and\s+then\s+/i.test(step)) {
        lastThenIndex = i;
        break;
      }
    }

    // If no "Then" step found, use all steps
    if (lastThenIndex === -1) {
      return scenario.steps.map(step => ({
        content: step,
        expected: '',
      }));
    }

    // Add only steps BEFORE the last "Then" to the Steps field
    for (let i = 0; i < lastThenIndex; i++) {
      steps.push({
        content: scenario.steps[i],
        expected: '',
      });
    }

    // The last "Then" and any following "And" steps will be handled separately
    // They go to the Expected Result field, not Steps

    return steps;
  }
}

