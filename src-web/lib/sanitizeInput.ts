/**
 * For filter expressions, we use minimal processing
 * React automatically escapes rendered content, so XSS is not a concern
 */
export function sanitizeInput(input: string): string {
  return input;
}

/**
 * Basic validation for history input
 * Note: Validation is minimal since React escapes all rendered content
 * and these expressions are not executed as code
 */
export function isValidHistoryInput(input: string): boolean {
  // Just ensure it's not empty or only whitespace
  return input.trim().length > 0;
}

/**
 * Prepare input for history storage
 * Minimal processing - just trim and limit length
 */
export function prepareHistoryInput(input: string): string | null {
  const trimmed = input.trim();

  if (!trimmed) {
    return null;
  }

  // Limit length to prevent storage abuse (1000 chars is plenty for filters)
  const maxLength = 1000;

  return trimmed.slice(0, maxLength);
}
