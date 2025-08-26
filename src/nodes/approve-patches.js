import { logger } from '../utils/logger.js';
import { ProcessingError } from '../utils/error-handler.js';
import inquirer from 'inquirer';
import chalk from 'chalk';
import readline from 'readline';

export async function approvePatchesNode(state) {
  logger.info('🤔 Requesting user approval for patches...');
  
  try {
    // Validate required data
    if (!state.patches || state.patches.length === 0) {
      logger.info('No patches to approve');
      return {
        ...state,
        approvedPatches: [],
        patchApprovalCompleted: new Date().toISOString()
      };
    }
    
    // Check if auto-apply is enabled
    if (state.auto_apply) {
      logger.info('Auto-apply enabled - approving all patches automatically');
      const approvedPatches = [...state.patches];
      
      return {
        ...state,
        approvedPatches,
        patchApprovalCompleted: new Date().toISOString(),
        autoApplied: true
      };
    }
    
    // Present patches to user for approval
    const approvedPatches = await presentPatchesForApproval(state.patches);
    
    logger.info('Patch approval completed', { 
      totalPatches: state.patches.length,
      approvedCount: approvedPatches.length,
      rejectedCount: state.patches.length - approvedPatches.length
    });
    
    return {
      ...state,
      approvedPatches,
      patchApprovalCompleted: new Date().toISOString()
    };
  } catch (error) {
    logger.error('Failed to get patch approval', { error: error.message });
    throw new ProcessingError(`Failed to get patch approval: ${error.message}`, { 
      originalError: error.message 
    });
  }
}

async function presentPatchesForApproval(patches) {
  const approvedPatches = [];
  
  console.log(chalk.blue('\n📋 Patch Approval Required'));
  console.log(chalk.gray(`Found ${patches.length} suggested patches to review:\n`));
  
  for (let i = 0; i < patches.length; i++) {
    const patch = patches[i];
    const isApproved = await presentSinglePatch(patch, i + 1, patches.length);
    
    if (isApproved) {
      approvedPatches.push(patch);
    }
  }
  
  // Summary
  console.log(chalk.green(`\n✅ Approval complete: ${approvedPatches.length}/${patches.length} patches approved`));
  
  if (approvedPatches.length === 0) {
    console.log(chalk.yellow('⚠️  No patches were approved. Resume will remain unchanged.'));
  }
  
  return approvedPatches;
}

async function presentSinglePatch(patch, currentIndex, totalCount) {
  const priorityColor = getPriorityColor(patch.priority);
  const priorityIcon = getPriorityIcon(patch.priority);
  
  console.log(chalk.blue(`\n--- Patch ${currentIndex}/${totalCount} ---`));
  console.log(`${priorityIcon} ${priorityColor(patch.description)}`);
  console.log(chalk.gray(`Type: ${patch.type}`));
  console.log(chalk.gray(`Impact: ${patch.details.impact}`));
  console.log(chalk.gray(`Confidence: ${Math.round(patch.confidence * 100)}%`));
  
  if (patch.details.value) {
    console.log(chalk.cyan(`Value: ${patch.details.value}`));
  }
  
  if (patch.details.action) {
    console.log(chalk.cyan(`Action: ${patch.details.action}`));
  }
  
  // Present approval options with keyboard-friendly choices
  let action;
  try {
    const result = await inquirer.prompt([
      {
        type: 'list',
        name: 'action',
        message: 'What would you like to do with this patch? (Use arrow keys or type number)',
        choices: [
          { name: '1. Apply this patch', value: 'apply' },
          { name: '2. Skip this patch', value: 'skip' },
          { name: '3. Show more details', value: 'details' },
          { name: '4. Pause and review all patches', value: 'pause' }
        ],
        default: 'apply'
      }
    ]);
    action = result.action;
  } catch (error) {
    // Fallback to simple number input if inquirer fails
    console.log(chalk.yellow('⚠️  Arrow keys not working. Please type the number (1-4):'));
    action = await getNumberInput(1, 4);
  }
  
  if (action === 'details') {
    await showPatchDetails(patch);
    // Re-prompt for action after showing details
    let finalAction;
    try {
      const result = await inquirer.prompt([
        {
          type: 'list',
          name: 'finalAction',
          message: 'What would you like to do with this patch?',
          choices: [
            { name: '1. Apply this patch', value: 'apply' },
            { name: '2. Skip this patch', value: 'skip' }
          ],
          default: 'apply'
        }
      ]);
      finalAction = result.finalAction;
    } catch (error) {
      // Fallback to simple number input if inquirer fails
      console.log(chalk.yellow('⚠️  Arrow keys not working. Please type the number (1-2):'));
      finalAction = await getNumberInput(1, 2);
    }
    return finalAction === 'apply';
  }
  
  if (action === 'pause') {
    return await pauseAndReviewAllPatches(patches, currentIndex - 1);
  }
  
  return action === 'apply';
}

async function showPatchDetails(patch) {
  console.log(chalk.blue('\n📖 Patch Details:'));
  console.log(chalk.gray('Description:'), patch.description);
  console.log(chalk.gray('Type:'), patch.type);
  console.log(chalk.gray('Priority:'), patch.priority);
  console.log(chalk.gray('Estimated Effort:'), patch.estimatedEffort);
  console.log(chalk.gray('Confidence:'), `${Math.round(patch.confidence * 100)}%`);
  console.log(chalk.gray('Impact:'), patch.details.impact);
  console.log(chalk.gray('Category:'), patch.details.category);
  
  if (patch.details.action) {
    console.log(chalk.gray('Action:'), patch.details.action);
  }
  
  if (patch.details.value) {
    console.log(chalk.gray('Value:'), patch.details.value);
  }
  
  console.log(chalk.gray('ID:'), patch.id);
}

async function pauseAndReviewAllPatches(patches, currentIndex) {
  console.log(chalk.yellow('\n⏸️  Pausing for full review...'));
  
  let reviewAction;
  try {
    const result = await inquirer.prompt([
      {
        type: 'list',
        name: 'reviewAction',
        message: 'What would you like to do?',
        choices: [
          { name: '1. Review all remaining patches', value: 'review' },
          { name: '2. Approve all remaining patches', value: 'approve_all' },
          { name: '3. Skip all remaining patches', value: 'skip_all' },
          { name: '4. Continue one by one', value: 'continue' }
        ]
      }
    ]);
    reviewAction = result.reviewAction;
  } catch (error) {
    // Fallback to simple number input if inquirer fails
    console.log(chalk.yellow('⚠️  Arrow keys not working. Please type the number (1-4):'));
    const num = await getNumberInput(1, 4);
    reviewAction = getReviewActionFromNumber(num);
  }
  
  if (reviewAction === 'review') {
    return await reviewAllRemainingPatches(patches, currentIndex);
  } else if (reviewAction === 'approve_all') {
    console.log(chalk.green('✅ All remaining patches approved!'));
    return true; // This will be handled by the calling function
  } else if (reviewAction === 'skip_all') {
    console.log(chalk.yellow('❌ All remaining patches skipped!'));
    return false; // This will be handled by the calling function
  } else {
    console.log(chalk.blue('🔄 Continuing with individual patch review...'));
    return null; // Continue with individual review
  }
}

async function reviewAllRemainingPatches(patches, currentIndex) {
  const remainingPatches = patches.slice(currentIndex);
  const approvedIndices = [];
  
  console.log(chalk.blue(`\n📋 Reviewing ${remainingPatches.length} remaining patches:`));
  
  for (let i = 0; i < remainingPatches.length; i++) {
    const patch = remainingPatches[i];
    const priorityIcon = getPriorityIcon(patch.priority);
    console.log(`${i + 1}. ${priorityIcon} ${patch.description}`);
  }
  
  const { selectedPatches } = await inquirer.prompt([
    {
      type: 'checkbox',
      name: 'selectedPatches',
      message: 'Select patches to approve:',
      choices: remainingPatches.map((patch, index) => ({
        name: `${patch.description} (${patch.priority} priority)`,
        value: index,
        checked: patch.priority === 'high' // Auto-check high priority patches
      }))
    }
  ]);
  
  approvedIndices.push(...selectedPatches);
  
  // Update the patches array to mark approved ones
  for (let i = 0; i < remainingPatches.length; i++) {
    remainingPatches[i].approved = approvedIndices.includes(i);
  }
  
  console.log(chalk.green(`\n✅ Selected ${approvedIndices.length} patches for approval`));
  
  // Return to individual review mode
  return null;
}

function getPriorityColor(priority) {
  switch (priority) {
    case 'high':
      return chalk.red;
    case 'medium':
      return chalk.yellow;
    case 'low':
      return chalk.green;
    default:
      return chalk.white;
  }
}

function getPriorityIcon(priority) {
  switch (priority) {
    case 'high':
      return '🔴';
    case 'medium':
      return '🟡';
    case 'low':
      return '🟢';
    default:
      return '⚪';
  }
}

// Fallback function for number input when inquirer fails
function getNumberInput(min, max) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });
    
    const askForNumber = () => {
      rl.question(`Enter a number (${min}-${max}): `, (input) => {
        const num = parseInt(input.trim());
        if (num >= min && num <= max) {
          rl.close();
          resolve(getActionFromNumber(num));
        } else {
          console.log(chalk.red(`Please enter a number between ${min} and ${max}`));
          askForNumber();
        }
      });
    };
    
    askForNumber();
  });
}

function getActionFromNumber(num) {
  switch (num) {
    case 1: return 'apply';
    case 2: return 'skip';
    case 3: return 'details';
    case 4: return 'pause';
    default: return 'apply';
  }
}

function getReviewActionFromNumber(num) {
  switch (num) {
    case 1: return 'review';
    case 2: return 'approve_all';
    case 3: return 'skip_all';
    case 4: return 'continue';
    default: return 'continue';
  }
}
