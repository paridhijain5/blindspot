export function friendlyAnalysisError(message: string): string {
  if (/45-second|survey time limit/i.test(message)) {
    return "The survey time limit was reached before claim analysis finished.";
  }
  if (/timeout|timed out|operation was aborted/i.test(message)) {
    return "The analysis provider did not respond in time. The source remains available, but its claims were not checked.";
  }
  if (/invalid json|validate json|failed_generation/i.test(message)) {
    return "The analysis provider returned an unusable structured response. The source remains available, but its claims were not checked.";
  }
  return message;
}
