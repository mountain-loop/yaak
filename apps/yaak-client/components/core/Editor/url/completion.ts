import { genericCompletion } from '../genericCompletion';

export const completions = genericCompletion({
  options: [
    { label: 'http://', type: 'constant' },
    { label: 'https://', type: 'constant' },
  ],
  minMatch: 1,
});
