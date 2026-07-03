// Shared constants/labels for Application Intelligence V2. No runtime deps.

export const ENGINE_VERSION_V2 = 'application_intelligence_v2';

export const MATCH_TYPES = ['exact', 'adjacent', 'transferable', 'weak', 'missing'];
export const BULLET_CLASSES = ['safe_to_use', 'needs_confirmation', 'not_recommended', 'unsupported'];

export function confidenceLabelV2(c) {
  if (c >= 0.66) return 'high';
  if (c >= 0.4) return 'moderate';
  return 'low';
}
