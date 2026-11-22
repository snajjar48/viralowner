/**
 * The worker's message when our side can't go on for a while (the Anthropic balance ran out):
 * SERVICE_HICCUP in worker/app.py, word for word. A failed version with it alerts the owner.
 */
export const SERVICE_HICCUP =
  "we’re having a hiccup on our side. your clips and settings are saved: try again in a little while (it’s free).";
