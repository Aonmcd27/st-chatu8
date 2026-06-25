// @ts-nocheck
/**
 * A centralized module to track the status of all in-flight image generation prompts.
 * This prevents duplicate requests from different parts of the extension,
 * such as the pre-generation manager and the manual/automatic click triggers in iframe.js.
 */

const currentlyGenerating = new Set();

/**
 * Checks if a generation for a specific prompt is already in progress.
 * @param {string} prompt - The prompt to check.
 * @returns {boolean} - True if a generation is in progress, false otherwise.
 */
export function isGenerating(prompt) {
    return currentlyGenerating.has(prompt);
}

/**
 * Marks a prompt as "in-progress" for generation.
 * @param {string} prompt - The prompt to mark.
 */
export function startGenerating(prompt) {
    currentlyGenerating.add(prompt);
}

/**
 * Marks a prompt as "finished" by removing it from the in-progress set.
 * @param {string} prompt - The prompt to remove.
 */
export function stopGenerating(prompt) {
    currentlyGenerating.delete(prompt);
}
