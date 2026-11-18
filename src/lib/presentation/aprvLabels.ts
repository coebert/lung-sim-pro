/**
 * Wording for the APRV recruitment value. It is a modelled score from the
 * passive-lung model, so every display labels it the same way and none
 * turns it into treatment advice.
 */
export const APRV_RECRUITMENT_LABEL = 'Modelled recruitment score';
export const APRV_RECRUITMENT_QUALIFIER = 'passive-model estimate, not adjusted for spontaneous effort';
export function aprvRecruitmentText(score: number): string {
  return `${APRV_RECRUITMENT_LABEL} ${Math.round(score * 100)}% (${APRV_RECRUITMENT_QUALIFIER}; illustrative, not a measurement).`;
}
