export interface ParsedScenario {
  name: string;
  steps: string[];
  expectedResult: string;
}

export class GherkinParser {
  /**
   * Parses Gherkin-style scenarios from a text description
   */
  parseScenarios(description: string): ParsedScenario[] {
    if (!description || description.trim().length === 0) {
      return [];
    }

    const scenarios: ParsedScenario[] = [];
    
    // Pattern to match scenario blocks - allows blank lines between title and steps
    // Matches: "Scenario X:" or "Scenario:" followed by optional blank lines, then steps
    // Handles multiline scenarios with Given/When/Then/And steps
    // Supports multi-line titles (title can be on same line or following lines)
    const scenarioPattern = /Scenario\s*(\d+)?\s*:?\s*((?:[^\n]*(?:\n(?!\s*(?:Given|When|Then|And|But|Scenario))[^\n]*)*))(?:\n\s*)*((?:Given|When|Then|And|But)[^\n]*(?:\n(?!Scenario)[^\n]*)*)/gi;
    
    let match;
    while ((match = scenarioPattern.exec(description)) !== null) {
      const scenarioNumber = match[1] || '';
      const scenarioTitle = match[2]?.trim()?.replace(/\n+/g, ' ').trim() || `Scenario ${scenarioNumber || scenarios.length + 1}`;
      const stepsBlock = match[3] || '';

      // Extract individual steps
      const steps = this.extractSteps(stepsBlock);
      
      if (steps.length === 0) {
        continue; // Skip scenarios with no steps
      }

      // Extract expected result (last "Then" or "And then" statement)
      const expectedResult = this.extractExpectedResult(steps);

      scenarios.push({
        name: scenarioTitle.trim() || `Scenario ${scenarioNumber || scenarios.length + 1}`,
        steps: steps,
        expectedResult: expectedResult,
      });
    }

    // Fallback: Try to find scenarios without explicit "Scenario:" marker
    // Look for patterns like "When... Then..." blocks
    if (scenarios.length === 0) {
      const fallbackScenarios = this.parseFallbackScenarios(description);
      scenarios.push(...fallbackScenarios);
    }

    return scenarios;
  }

  /**
   * Extracts individual steps from a steps block
   */
  private extractSteps(stepsBlock: string): string[] {
    const steps: string[] = [];
    
    // Use line-by-line parsing which handles blank lines better
    // Preserve the full step including keywords (Given/When/Then/And/But)
    const lines = stepsBlock.split('\n');
    for (const line of lines) {
      const trimmed = line.trim();
      if (/^(Given|When|Then|And|But)\s+/i.test(trimmed)) {
        // Keep the full step including the keyword
        steps.push(trimmed);
      }
    }

    return steps;
  }

  /**
   * Extracts expected result from steps (last "Then" or "And then")
   */
  private extractExpectedResult(steps: string[]): string {
    // Look for the last "Then" step and extract just the content (without keyword)
    for (let i = steps.length - 1; i >= 0; i--) {
      const step = steps[i];
      if (/^then\s+/i.test(step)) {
        return step.replace(/^then\s+/i, '').trim();
      }
      if (/^and\s+then\s+/i.test(step)) {
        return step.replace(/^and\s+then\s+/i, '').trim();
      }
    }

    // If no explicit "Then", return the content of the last step (without keyword)
    if (steps.length > 0) {
      const lastStep = steps[steps.length - 1];
      // Remove keyword if present
      return lastStep.replace(/^(Given|When|Then|And|But)\s+/i, '').trim();
    }
    
    return '';
  }

  /**
   * Fallback parser for scenarios without explicit "Scenario:" markers
   */
  private parseFallbackScenarios(description: string): ParsedScenario[] {
    const scenarios: ParsedScenario[] = [];
    
    // Look for blocks that start with "When" and contain "Then"
    const whenThenPattern = /When\s+(.+?)(?:\n(?:And|But)\s+(.+?))*\nThen\s+(.+?)(?:\n(?:And|But)\s+(.+?))*(?=\n\n|\nWhen\s+|$)/gis;
    
    let match;
    let scenarioIndex = 1;
    while ((match = whenThenPattern.exec(description)) !== null) {
      const steps: string[] = [];
      
      // Add When step
      if (match[1]) steps.push(match[1].trim());
      
      // Add And/But steps before Then
      if (match[2]) {
        const andSteps = match[2].split(/\n(?:And|But)\s+/).filter(s => s.trim());
        steps.push(...andSteps.map(s => s.trim()));
      }
      
      // Add Then step
      if (match[3]) steps.push(match[3].trim());
      
      // Add And/But steps after Then
      if (match[4]) {
        const andSteps = match[4].split(/\n(?:And|But)\s+/).filter(s => s.trim());
        steps.push(...andSteps.map(s => s.trim()));
      }

      if (steps.length > 0) {
        const expectedResult = steps[steps.length - 1] || '';
        scenarios.push({
          name: `Scenario ${scenarioIndex}`,
          steps: steps,
          expectedResult: expectedResult,
        });
        scenarioIndex++;
      }
    }

    return scenarios;
  }
}

