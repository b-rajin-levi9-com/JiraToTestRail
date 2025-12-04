#!/usr/bin/env node

import { Command } from 'commander';
import { SyncService } from './sync/syncService';
import { TestRailClient } from './testrail/testrailClient';
import { logger } from './utils/logger';
import { config } from './utils/config';

const program = new Command();

program
  .name('jira-testrail-sync')
  .description('Sync Gherkin scenarios from Jira tickets to TestRail test cases')
  .version('1.0.0');

program
  .command('sync')
  .description('Sync Gherkin scenarios from a Jira ticket to TestRail')
  .argument('<jira-key>', 'Jira ticket key (e.g., PROJ-123)')
  .option('--suite-id <id>', 'TestRail suite ID (will use first section or specified section-name)')
  .option('--suite-name <name>', 'TestRail suite name (alternative to --suite-id, requires --create-suite if suite doesn\'t exist)')
  .option('--section-id <id>', 'TestRail section ID (alternative to --suite-id)')
  .option('--section-name <name>', 'Section name to use when --suite-id or --suite-name is provided (case-insensitive)')
  .option('--create-suite', 'Create suite if it doesn\'t exist (requires --suite-name)', false)
  .option('--create-section', 'Create section if it doesn\'t exist (requires --section-name)', false)
  .option('--project-id <id>', 'TestRail project ID (overrides TESTRAIL_PROJECT_ID from .env)')
  .option('--dry-run', 'Preview changes without applying them', false)
  .option('--verbose', 'Enable verbose logging', false)
  .action(async (jiraKey: string, options: any) => {
    try {
      // Set verbose logging if requested
      logger.setVerbose(options.verbose);

      // Get project ID from option or config
      const projectId = options.projectId
        ? parseInt(options.projectId, 10)
        : config.testrail.projectId;

      if (!projectId) {
        logger.error(
          'TestRail project ID is required. Provide it via --project-id or TESTRAIL_PROJECT_ID in .env'
        );
        process.exit(1);
      }

      // Validate that either suite-id, suite-name, or section-id is provided
      if (!options.suiteId && !options.suiteName && !options.sectionId) {
        logger.error('Either --suite-id, --suite-name, or --section-id must be provided.');
        process.exit(1);
      }

      if (options.suiteId && options.suiteName) {
        logger.error('Cannot specify both --suite-id and --suite-name. Use only one.');
        process.exit(1);
      }

      if (options.suiteId && options.sectionId) {
        logger.error('Cannot specify both --suite-id and --section-id. Use only one.');
        process.exit(1);
      }

      if (options.suiteName && options.sectionId) {
        logger.error('Cannot specify both --suite-name and --section-id. Use only one.');
        process.exit(1);
      }

      if (options.createSuite && !options.suiteName) {
        logger.error('--create-suite can only be used with --suite-name.');
        process.exit(1);
      }

      if (options.sectionName && !options.suiteId && !options.suiteName) {
        logger.error('--section-name can only be used with --suite-id or --suite-name.');
        process.exit(1);
      }

      // Validate Jira key format (basic check)
      if (!/^[A-Z]+-\d+$/.test(jiraKey)) {
        logger.warning(
          `Jira key "${jiraKey}" doesn't match expected format (e.g., PROJ-123). Proceeding anyway...`
        );
      }

      logger.info(`Starting sync: ${jiraKey} → TestRail Project ${projectId}`);
      if (options.suiteId) {
        logger.info(`Using suite ID: ${options.suiteId}`);
        if (options.sectionName) {
          logger.info(`Looking for section: "${options.sectionName}"`);
        }
      } else if (options.suiteName) {
        logger.info(`Using suite name: "${options.suiteName}"`);
        if (options.createSuite) {
          logger.info('Will create suite if it doesn\'t exist');
        }
        if (options.sectionName) {
          logger.info(`Looking for section: "${options.sectionName}"`);
          if (options.createSection) {
            logger.info('Will create section if it doesn\'t exist');
          }
        }
      } else {
        logger.info(`Using section ID: ${options.sectionId}`);
      }
      if (options.dryRun) {
        logger.warning('Running in DRY RUN mode - no changes will be made');
      }
      logger.info('');

      // Perform sync
      const syncService = new SyncService();
      const result = await syncService.syncTicketToTestRail(
        jiraKey,
        projectId,
        options.suiteId ? parseInt(options.suiteId, 10) : undefined,
        options.sectionId ? parseInt(options.sectionId, 10) : undefined,
        options.sectionName,
        options.dryRun,
        options.suiteName,
        options.createSuite || false,
        options.createSection || false
      );

      // Display results
      logger.info('');
      if (result.scenariosFound === 0) {
        logger.warning('No scenarios were found in the Jira ticket description.');
        logger.info('Make sure the ticket contains Gherkin-style scenarios like:');
        logger.info('  Scenario 1: User login');
        logger.info('  When user enters credentials');
        logger.info('  Then user is logged in');
        process.exit(0);
      }

      if (result.errors.length > 0) {
        logger.error('\nErrors occurred during sync:');
        result.errors.forEach((error) => logger.error(`  - ${error}`));
        process.exit(1);
      }

      if (options.dryRun) {
        logger.success('\n✓ Dry run completed successfully. Use without --dry-run to apply changes.');
      } else {
        logger.success('\n✓ Sync completed successfully!');
      }

      process.exit(0);
    } catch (error: any) {
      logger.error(`\n✗ Sync failed: ${error.message}`);
      if (options.verbose && error.stack) {
        logger.error(error.stack);
      }
      process.exit(1);
    }
  });

program
  .command('delete-suite')
  .description('Delete a TestRail suite')
  .argument('<suite-id>', 'TestRail suite ID to delete')
  .option('--project-id <id>', 'TestRail project ID (overrides TESTRAIL_PROJECT_ID from .env)')
  .option('--dry-run', 'Preview deletion without applying it', false)
  .option('--verbose', 'Enable verbose logging', false)
  .action(async (suiteId: string, options: any) => {
    try {
      // Set verbose logging if requested
      logger.setVerbose(options.verbose);

      const suiteIdNum = parseInt(suiteId, 10);
      if (isNaN(suiteIdNum)) {
        logger.error(`Invalid suite ID: ${suiteId}. Must be a number.`);
        process.exit(1);
      }

      if (options.dryRun) {
        logger.warning('Running in DRY RUN mode - no changes will be made');
        logger.info(`[DRY RUN] Would delete suite ID: ${suiteIdNum}`);
        logger.warning('⚠️  WARNING: Deleting a suite will also delete:');
        logger.warning('   - The suite itself');
        logger.warning('   - All sections in the suite');
        logger.warning('   - All test cases in the suite');
        logger.warning('   - All baselines associated with the suite');
        logger.warning('⚠️  NOTE: Suite deletion is NOT allowed in Single Suite Mode projects.');
        logger.success('\n✓ Dry run completed. Use without --dry-run to delete the suite.');
        process.exit(0);
      }

      // Confirm deletion
      logger.warning(`⚠️  WARNING: You are about to delete suite ID ${suiteIdNum}`);
      logger.warning('⚠️  This will permanently delete:');
      logger.warning('   - The suite itself');
      logger.warning('   - All sections in the suite');
      logger.warning('   - All test cases in the suite');
      logger.warning('   - All baselines associated with the suite');
      logger.warning('⚠️  NOTE: Suite deletion is NOT allowed in Single Suite Mode projects.');
      logger.warning('⚠️  This action cannot be undone!');
      logger.info('');

      // Perform deletion
      const testrailClient = new TestRailClient();
      await testrailClient.deleteSuite(suiteIdNum);

      logger.success(`\n✓ Suite ID ${suiteIdNum} deleted successfully!`);
      process.exit(0);
    } catch (error: any) {
      logger.error(`\n✗ Delete failed: ${error.message}`);
      if (options.verbose && error.stack) {
        logger.error(error.stack);
      }
      process.exit(1);
    }
  });

// Parse command line arguments
program.parse();

