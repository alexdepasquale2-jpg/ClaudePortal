// The reply: their words, one feeling, one verse or none, one question.
// No "you should". No verdict on the theology.

import { LINES, VERSES, type Verse } from './voice';
import { type Feeling, type Weather, feelingFor, has, hasAny, inferWeather, keywordsFor, normalize } from './weather';

export type ReplyKind =
  | 'nothing'
  | 'darkWaiting'
  | 'lovedStopped'
  | 'anger'
  | 'fake'
  | 'stillHere'
  | 'supperGoodbye'
  | 'almostNothing'
  | 'plain';

export interface Reply {
  kind: ReplyKind;
  quote: string;
  line: string | null;
  feeling: Feeling;
  verse: Verse | null;
  question: string | null;
  /** Anger gets two real controls instead of a question. */
  speakStay: boolean;
  /** Next visit may give the one small story. */
  owesSmallStory: boolean;
}

export const MAX_QUOTE_WORDS = 12;

/** At most twelve of their words, in order, untouched. */
export function quoteOf(text: string): string {
  const words = text.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "I don't know";
  return words.slice(0, MAX_QUOTE_WORDS).join(' ');
}

const QUESTIONS: Record<Weather, string> = {
  anger: '',
  meal: 'Who was at the table?',
  dark: 'What was the dark like?',
  name: 'What were you called, then?',
  light: 'Where did the light land?',
  leaving: 'What did the leaving take?',
  love: 'Who stayed?',
  notKnowing: 'Are you hungry, or just tired?',
};

// Only when it echoes.
const ECHO: Partial<Record<Weather, Verse>> = {
  meal: VERSES.dine,
  light: VERSES.light,
  name: VERSES.known,
  love: VERSES.song,
  leaving: VERSES.abide,
  notKnowing: VERSES.stillVoice,
};

export function composeReply(text: string): Reply {
  const weather = inferWeather(text);
  const n = normalize(text);
  const base = { quote: quoteOf(text), speakStay: false, owesSmallStory: false };

  if (weather === 'anger') {
    if (has(text, 'if you loved') || (hasAny(text, ['loved', 'love']) && hasAny(text, ['stop', 'stopped']))) {
      return {
        ...base,
        kind: 'lovedStopped',
        line: 'I heard the love under the charge. I will not argue.',
        feeling: 'angry',
        verse: VERSES.forsaken,
        question: null,
        speakStay: true,
      };
    }
    return { ...base, kind: 'anger', line: LINES.anger, feeling: 'angry', verse: null, question: null, speakStay: true };
  }

  if (n === '' || hasAny(text, ['idk', "i don't know"])) {
    return {
      ...base,
      kind: 'nothing',
      line: "That is already a story. ‘I don’t know’ is a door cracked.",
      feeling: 'unsure',
      verse: VERSES.dine,
      question: 'Are you hungry, or just tired?',
    };
  }

  if (weather === 'meal' && hasAny(text, keywordsFor('leaving'))) {
    return {
      ...base,
      kind: 'supperGoodbye',
      line: 'You named the meal as a leaving. I named it as stay a little longer. Both can sit.',
      feeling: 'grieving',
      verse: VERSES.brake,
      question: 'Who is missing from the table?',
    };
  }

  if (weather === 'dark' && hasAny(text, ['waiting', 'waited', 'jonah', 'whale', 'belly'])) {
    return {
      ...base,
      kind: 'darkWaiting',
      line: 'You kept the dark and the waiting. That was the true part.',
      feeling: 'afraid',
      verse: VERSES.jonah,
      question: 'What did the waiting sound like?',
    };
  }

  if (weather === 'love' && hasAny(text, ['still here', 'see me', 'seen', 'wanted'])) {
    return {
      ...base,
      kind: 'stillHere',
      line: 'The wanting is not small. Stay.',
      feeling: 'loving',
      verse: VERSES.abide,
      question: 'What should I call this hour?',
    };
  }

  if (
    hasAny(text, ['fake', 'not sure', 'never read', "don't know the bible", "don't know the book", 'no bible', 'not religious'])
  ) {
    return {
      ...base,
      kind: 'fake',
      line: 'Not knowing is not faking. You opened a door.',
      feeling: 'unsure',
      verse: VERSES.stillVoice,
      question: 'Your story first, or one small story?',
      owesSmallStory: true,
    };
  }

  const words = n.split(' ').length;
  if (words <= 2) {
    return {
      ...base,
      kind: 'almostNothing',
      line: LINES.almostNothing,
      feeling: feelingFor(weather, text),
      verse: null,
      question: QUESTIONS[weather],
    };
  }

  return {
    ...base,
    kind: 'plain',
    line: weather === 'love' ? LINES.love : weather === 'notKnowing' ? LINES.notKnowing : null,
    feeling: feelingFor(weather, text),
    verse: ECHO[weather] ?? null,
    question: QUESTIONS[weather],
  };
}
