#!/usr/bin/env node

import { Command } from 'commander';
import { SyncService } from './sync/syncService';
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
  .option('--section-id <id>', 'TestRail section ID (alternative to --suite-id)')
  .option('--section-name <name>', 'Section name to use when --suite-id is provided (case-insensitive)')
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

      // Validate that either suite-id or section-id is provided
      if (!options.suiteId && !options.sectionId) {
        logger.error('Either --suite-id or --section-id must be provided.');
        process.exit(1);
      }

      if (options.suiteId && options.sectionId) {
        logger.error('Cannot specify both --suite-id and --section-id. Use only one.');
        process.exit(1);
      }

      if (options.sectionName && !options.suiteId) {
        logger.error('--section-name can only be used with --suite-id.');
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
        options.dryRun
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

// Parse command line arguments
program.parse();

