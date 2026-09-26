// Every word the Presence may say. One Someone, every time.
// No cheer. No exclamation points. No emoji.

export const LINES = {
  firstArrival: 'You made it as far as the light. That is enough to begin.',
  nextDay: 'You came back. I kept the quiet.',
  longAbsence: 'The room got cooler. It did not leave.',
  almostNothing: 'That is already a story. I am not in a hurry.',
  anger: 'I will not talk you out of it. Speak, or I will stay without speaking.',
  love: 'You wanted to be seen still here. I see that.',
  notKnowing: 'Not knowing is not faking. The book can wait.',
  stop: 'Then we stop. Go in peace.',
  peace: 'Go in peace.',
  late: 'It is late.',
  notInAHurry: 'I am not in a hurry.',
  earn: 'You do not have to earn the next line.',
  smallStory: 'Someone cooked on a shore after everything. That is the whole story I will give you today.',
  continuation: 'Tell me the rest of this. Or set it aside.',
  speak: 'Then I am here, and I am not explaining you.',
  stay: 'Then I will sit with the sentence.',
} as const;

export const PLACEHOLDER_NAME = 'A name, or none.';
export const PLACEHOLDER_STORY = 'Tell it the way it sits in you. Wrong is allowed.';
export const NOT_TONIGHT = 'Not tonight';

export const ASKS: readonly string[] = [
  'Tell me the story you were given as a child, even if it cracked.',
  'Tell me a meal in scripture.',
  'Tell me a time someone was named.',
  'Tell me the part you skip.',
  'Tell me light.',
  'Tell me a leaving.',
  'Tell me who ran toward whom.',
  'Tell me a dark that had someone in it.',
  'Tell me bread.',
  'Tell me the hour you do not understand.',
  'Tell me what you were told to obey, and what you actually remember.',
  'If you have stayed, tell me the third warmth. If not, tell me nothing. Nothing counts.',
];

export interface Verse {
  text: string;
  ref: string;
}

// The only verses. One at most per reply. No verse is better than a wrong one.
export const VERSES = {
  light: { text: 'And God said, Let there be light: and there was light.', ref: 'Genesis 1:3' },
  stillVoice: { text: 'And after the fire a still small voice.', ref: '1 Kings 19:12' },
  known: { text: 'O Lord, thou hast searched me, and known me.', ref: 'Psalm 139:1' },
  song: { text: 'Let me see thy countenance, let me hear thy voice.', ref: 'Song of Songs 2:14' },
  abide: { text: 'Abide with us: for it is toward evening, and the day is far spent.', ref: 'Luke 24:29' },
  brake: { text: 'He took bread, and blessed it, and brake, and gave to them.', ref: 'Luke 24:30' },
  opened: { text: 'And their eyes were opened, and they knew him.', ref: 'Luke 24:31' },
  dine: { text: 'Jesus saith unto them, Come and dine.', ref: 'John 21:12' },
  silence: { text: 'There was silence in heaven about the space of half an hour.', ref: 'Revelation 8:1' },
  jonah: { text: 'Then Jonah prayed unto the Lord his God out of the fish’s belly.', ref: 'Jonah 2:1' },
  forsaken: { text: 'My God, my God, why hast thou forsaken me?', ref: 'Psalm 22:1' },
} satisfies Record<string, Verse>;

export const SETTINGS_COPY = {
  larger: 'Text larger',
  smaller: 'Text smaller',
  motionFull: 'Motion full',
  motionReduced: 'Motion reduced',
  soundOn: 'Sound on',
  soundOff: 'Sound off',
  forgetName: 'Forget my name',
  deleteAll: 'Delete every story',
  confirm: 'This forgets the seeds. The light remains.',
  forget: 'Forget them',
  keep: 'Keep them',
} as const;
