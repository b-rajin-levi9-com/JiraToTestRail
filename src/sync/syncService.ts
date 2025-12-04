import { JiraClient, JiraTicket } from '../jira/jiraClient';
import { GherkinParser, ParsedScenario } from '../parser/gherkinParser';
import { TestRailClient, TestRailTestCase, TestRailTestCaseResponse, TestRailSection, TestRailSuite } from '../testrail/testrailClient';
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
    dryRun: boolean = false,
    suiteName?: string,
    createSuiteIfMissing: boolean = false,
    createSectionIfMissing: boolean = false
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
      // Step 0: Handle suite creation/resolution if suite-name is provided
      let resolvedSuiteId: number | undefined = testrailSuiteId;
      
      if (suiteName && !testrailSuiteId) {
        // Try to find existing suite by name
        logger.info(`Looking for suite: "${suiteName}"...`);
        const existingSuite = await this.testrailClient.findSuiteByName(testrailProjectId, suiteName);
        
        if (existingSuite) {
          resolvedSuiteId = existingSuite.id;
          logger.success(`Found existing suite "${suiteName}" (ID: ${existingSuite.id})`);
        } else if (createSuiteIfMissing) {
          if (dryRun) {
            logger.verboseLog(`[DRY RUN] Would create suite: "${suiteName}"`);
          } else {
            logger.info(`Creating suite: "${suiteName}"...`);
            const newSuite = await this.testrailClient.createSuite(testrailProjectId, suiteName);
            resolvedSuiteId = newSuite.id;
          }
        } else {
          // Get available suites for better error message
          try {
            const availableSuites = await this.testrailClient.getSuites(testrailProjectId);
            const suiteNames = availableSuites.map(s => `"${s.name}" (ID: ${s.id})`).join(', ');
            const errorMsg = suiteNames 
              ? `Suite "${suiteName}" not found in project ${testrailProjectId}.\n` +
                `Available suites: ${suiteNames}\n` +
                `Use --create-suite to create it automatically.`
              : `Suite "${suiteName}" not found in project ${testrailProjectId}.\n` +
                `No suites found in project. Use --create-suite to create it automatically.`;
            throw new Error(errorMsg);
          } catch (error: any) {
            // If we can't fetch suites, use simpler error message
            if (error.message.includes('not found')) {
              throw error; // Re-throw our error
            }
            throw new Error(
              `Suite "${suiteName}" not found in project ${testrailProjectId}. ` +
              `Use --create-suite to create it automatically.`
            );
          }
        }
      }

      // Resolve section ID from suite ID if needed
      let sectionId: number | undefined;
      if (resolvedSuiteId) {
        logger.info(`Fetching sections from suite ${resolvedSuiteId}...`);
        const sections = await this.testrailClient.getSections(testrailProjectId, resolvedSuiteId);
        
        // Ensure sections is an array
        if (!Array.isArray(sections)) {
          logger.verboseLog(`Unexpected response type: ${typeof sections}, value: ${JSON.stringify(sections)}`);
          throw new Error(`Invalid response from TestRail API. Expected array of sections, got ${typeof sections}.`);
        }
        
        if (sections.length === 0) {
          // If no sections exist and we should create one, create a default section
          if (createSectionIfMissing && sectionName) {
            if (dryRun) {
              logger.info(`[DRY RUN] Would create section: "${sectionName}" in suite ${resolvedSuiteId}`);
              // For dry run, create a mock section to continue the preview
              const mockSection: TestRailSection = {
                id: -1, // Placeholder ID for dry-run
                name: sectionName.split('/').pop() || sectionName,
                suite_id: resolvedSuiteId,
              };
              sectionId = mockSection.id;
              // Skip the rest of section finding logic since we've simulated the section creation
            } else {
              logger.info(`No sections found in suite ${resolvedSuiteId}. Creating section "${sectionName}"...`);
              const newSection = await this.createSectionHierarchy(
                testrailProjectId,
                resolvedSuiteId,
                sectionName,
                sections,
                createSectionIfMissing,
                dryRun
              );
              sectionId = newSection.id;
              // Skip the rest of section finding logic since we've already created the section
            }
          } else {
            throw new Error(
              `No sections found in suite ${resolvedSuiteId}. ` +
              `Please create a section first or use --create-section with --section-name to create it automatically.`
            );
          }
        }
        
        // Only find section if we haven't already set sectionId (i.e., when sections.length > 0 or section was not created)
        if (!sectionId) {
        
        // Find section by name if provided, otherwise use first section
        let selectedSection;
        if (sectionName) {
          const normalizedName = sectionName.toLowerCase().trim();
          
          // Preserve original casing for section names (for creation)
          const originalNameParts = sectionName.split('/').map(part => part.trim()).filter(part => part.length > 0);
          // Normalized parts for comparison (lowercase)
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
              const partNameNormalized = nameParts[i]; // For comparison (lowercase)
              const partNameOriginal = originalNameParts[i]; // For creation (original casing)
              const foundSection = sections.find((s: TestRailSection) => 
                s.name.toLowerCase().trim() === partNameNormalized && 
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
                
                // If createSectionIfMissing is enabled, create the missing section
                if (createSectionIfMissing) {
                  if (dryRun) {
                    logger.info(`[DRY RUN] Would create section: "${partNameOriginal}" ${parentContext}`);
                    // For dry run, create a mock section to continue the preview
                    const mockSection: TestRailSection = {
                      id: -1, // Placeholder ID for dry-run
                      name: partNameOriginal,
                      suite_id: resolvedSuiteId!,
                      parent_id: currentParentId || undefined,
                    };
                    sections.push(mockSection);
                    pathTraversed.push(mockSection.name);
                    currentParentId = mockSection.id;
                    if (i === nameParts.length - 1) {
                      selectedSection = mockSection;
                    }
                    continue;
                  } else {
                    logger.info(`Creating section: "${partNameOriginal}" ${parentContext}...`);
                    const newSection = await this.testrailClient.createSection(
                      testrailProjectId,
                      resolvedSuiteId!,
                      partNameOriginal,
                      currentParentId || undefined
                    );
                    // Update sections list and continue traversal
                    sections.push(newSection);
                    pathTraversed.push(newSection.name);
                    currentParentId = newSection.id;
                    if (i === nameParts.length - 1) {
                      selectedSection = newSection;
                    }
                    continue;
                  }
                } else {
                  throw new Error(
                    `Section "${partNameOriginal}" not found ${parentContext} in suite ${resolvedSuiteId}.\n` +
                    `Path: ${currentPath ? currentPath + '/' : ''}${partNameOriginal}\n` +
                    `Available sections ${parentContext}: ${availableSections || 'None'}\n` +
                    `Use --create-section to create missing sections automatically.`
                  );
                }
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
            // If createSectionIfMissing is enabled, create the section
            if (createSectionIfMissing) {
              if (dryRun) {
                logger.info(`[DRY RUN] Would create section: "${sectionName}"`);
                // For dry run, create a mock section to continue the preview
                const mockSection: TestRailSection = {
                  id: -1, // Placeholder ID for dry-run
                  name: sectionName.split('/').pop() || sectionName,
                  suite_id: resolvedSuiteId!,
                };
                selectedSection = mockSection;
              } else {
                logger.info(`Creating section: "${sectionName}"...`);
                const newSection = await this.createSectionHierarchy(
                  testrailProjectId,
                  resolvedSuiteId!,
                  sectionName,
                  sections,
                  createSectionIfMissing,
                  dryRun
                );
                selectedSection = newSection;
              }
            } else {
              throw new Error(
                `Section "${sectionName}" not found in suite ${resolvedSuiteId}.\n` +
                `Available sections: ${availableSections}\n` +
                `Use --create-section to create missing sections automatically.`
              );
            }
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
        
        // Set sectionId from selectedSection if we found/created one
        if (selectedSection) {
          sectionId = selectedSection.id;
          // Log section creation in dry-run mode
          if (dryRun && sectionId === -1) {
            logger.info(`[DRY RUN] Section "${selectedSection.name}" would be created in suite ${resolvedSuiteId}`);
          }
        }
        } // End of if (!sectionId) block
        
        // Ensure sectionId is set
        if (!sectionId) {
          throw new Error('Failed to resolve section ID. This should not happen.');
        }
        
        testrailSuiteId = resolvedSuiteId;
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
        throw new Error('Either suite ID, suite name, or section ID must be provided');
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
      // Skip fetching if we're in dry-run mode with a mock section (ID = -1)
      let existingTestCases: TestRailTestCaseResponse[] = [];
      if (dryRun && sectionId === -1) {
        logger.info(`[DRY RUN] Skipping test case fetch (section would be created)`);
        logger.verboseLog(`[DRY RUN] Would fetch existing test cases from TestRail section ${sectionId}...`);
      } else {
        logger.info(`Fetching existing test cases from TestRail section ${sectionId}...`);
        existingTestCases = await this.testrailClient.getTestCases(
          testrailProjectId,
          sectionId,
          testrailSuiteId || undefined
        );
      }

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

  /**
   * Creates a section hierarchy (handles parent/child relationships)
   */
  private async createSectionHierarchy(
    projectId: number,
    suiteId: number,
    sectionPath: string,
    existingSections: TestRailSection[],
    createSectionIfMissing: boolean,
    dryRun: boolean
  ): Promise<TestRailSection> {
    const nameParts = sectionPath.split('/').map(part => part.trim()).filter(part => part.length > 0);
    
    if (nameParts.length === 1) {
      // Simple section name - create top-level section
      if (dryRun) {
        throw new Error(`[DRY RUN] Section "${sectionPath}" would be created. Run without --dry-run to create it.`);
      }
      return await this.testrailClient.createSection(projectId, suiteId, nameParts[0]);
    } else {
      // Hierarchical path - create parent sections first
      let currentParentId: number | undefined = undefined;
      const pathTraversed: string[] = [];
      
      for (let i = 0; i < nameParts.length; i++) {
        const partName = nameParts[i];
        
        // Check if this section already exists
        const existingSection = existingSections.find((s: TestRailSection) => 
          s.name.toLowerCase().trim() === partName.toLowerCase().trim() && 
          (currentParentId === undefined ? !s.parent_id : s.parent_id === currentParentId)
        );
        
        if (existingSection) {
          currentParentId = existingSection.id;
          pathTraversed.push(existingSection.name);
        } else {
          // Create the section
          if (dryRun) {
            throw new Error(
              `[DRY RUN] Section "${partName}" would be created ${currentParentId ? `under "${pathTraversed.join('/')}"` : 'at top level'}. ` +
              `Run without --dry-run to create it.`
            );
          }
          
          logger.info(`Creating section: "${partName}" ${currentParentId ? `under "${pathTraversed.join('/')}"` : 'at top level'}...`);
          const newSection = await this.testrailClient.createSection(
            projectId,
            suiteId,
            partName,
            currentParentId
          );
          
          existingSections.push(newSection);
          currentParentId = newSection.id;
          pathTraversed.push(newSection.name);
        }
        
        // If this is the last part, return it
        if (i === nameParts.length - 1) {
          const finalSection = existingSections.find((s: TestRailSection) => s.id === currentParentId);
          if (finalSection) {
            return finalSection;
          }
          throw new Error(`Failed to create or find section "${sectionPath}"`);
        }
      }
      
      throw new Error(`Failed to create section hierarchy for "${sectionPath}"`);
    }
  }
}

