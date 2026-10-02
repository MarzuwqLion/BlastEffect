/**
 * Every name, line of dialogue and piece of UI text in the game. Names are
 * placeholders: change them here and nowhere else.
 */
import type { DialogueTree, SpeakerId } from './dialogue/types';

export const NAMES = {
  game: 'Neo Atlantis',
  subtitle: "Hathor's Reach",
  protagonist: 'Imani Cruz',
  imani: 'Imani',
  contact: 'Odette Baptiste',
  contactShort: 'Odette',
  bartender: 'Yaw Mensah',
  bartenderShort: 'Yaw',
  boss: 'The Crocodile',
  sister: 'Marisol Cruz',
  sisterShort: 'Mari',
  city: 'Neo Atlantis',
  district: "Hathor's Reach",
  station: 'Reach Station',
  club: 'The Sistrum',
  lair: 'The Basin',
  crew: 'the Teeth',
  implant: 'ka-amp',
};

export const SPEAKERS: Record<SpeakerId, string> = {
  imani: NAMES.imani,
  odette: NAMES.contactShort,
  yaw: NAMES.bartenderShort,
  croc: NAMES.boss,
};

export const WEAPON_NAMES = {
  smg: 'Asp SMG',
  rifle: 'Bennu Rifle',
};

export const POWER_NAMES = {
  pull: { name: 'Ka Snare', role: 'Primer', desc: 'Lifts an enemy, helpless. Blocked by shields and armor.' },
  throw: { name: 'Ka Lance', role: 'Detonator', desc: 'A bolt of ka that flings its target.' },
  charge: { name: 'Ka Surge', role: 'Detonator', desc: 'Rocket into a target. Restores 40% shield.' },
};

export const ENEMY_NAMES = {
  grunt: 'Enforcer',
  trooper: 'Warden',
  heavy: 'Hippo',
  boss: NAMES.boss,
};

export const LAYER_NAMES = {
  shield: 'Shields',
  armor: 'Armor',
  health: 'Health',
};

export const SIGNS = {
  sistrum: 'THE SISTRUM',
  lotus: 'BLUE LOTUS',
  hathors: 'SEVEN HATHORS',
  menat: 'MENAT',
  noodles: 'NILE NOODLE',
  repairs: 'IMPLANT REPAIR',
  station: 'REACH STATION',
  basin: 'THE BASIN',
  arrivals: 'ARRIVALS',
  closed: 'LAST TRAIN 02:40',
};

export const UI = {
  loading: 'Pressurizing…',
  pressStart: 'Press any key or button',
  start: 'Start',
  continue: 'Continue',
  resume: 'Resume',
  restartCheckpoint: 'Restart from checkpoint',
  settings: 'Settings',
  controls: 'Controls',
  quit: 'Quit to title',
  back: 'Back',
  paused: 'Paused',
  clickToResume: 'Click to resume',
  deathTitle: 'Flatlined',
  deathBody: 'Shields down, vitals gone. The Reach keeps its own.',
  retry: 'Retry from checkpoint',
  endTitle: 'Accounts Closed',
  endCredits: 'Neo Atlantis: Hathor\'s Reach. An MVP. Thanks for playing.',
  playAgain: 'Play again',
  sensitivity: 'Look sensitivity',
  invertY: 'Invert Y',
  masterVolume: 'Master volume',
  musicVolume: 'Music volume',
  sfxVolume: 'Effects volume',
  quality: 'Quality',
  textSize: 'Text size',
  aimAssist: 'Aim assist (gamepad)',
  on: 'On',
  off: 'Off',
  low: 'Low',
  medium: 'Medium',
  high: 'High',
  small: 'Small',
  large: 'Large',
  checkpoint: 'Checkpoint',
  objective: 'Objective',
  primed: 'PRIMED',
  combo: 'KA BURST',
  comboThrow: 'Lance detonation',
  comboCharge: 'Surge detonation',
  blockedShield: 'BLOCKED: SHIELDS',
  blockedArmor: 'BLOCKED: ARMOR',
  noTarget: 'NO TARGET',
  cooldown: 'COOLDOWN',
  reload: 'Reload',
  lowAmmo: 'Low ammo',
  noAmmo: 'No ammo',
  ammoRefilled: 'Ammo refilled',
  healthRestored: 'Health restored',
  intelWeakpoint: 'Intel: weak point marked on the Crocodile',
  intelRoute: 'Intel: service corridor code',
  skip: 'Skip',
  continueDialogue: 'Continue',
  meters: 'm',
  weakPoint: 'WEAK POINT',
  phase: 'Phase',
  titleBlurb:
    "Two hundred metres under the Caribbean, the domed city of Neo Atlantis never sleeps. In Hathor's Reach, a man called the Crocodile collects debts in implants. The last person who came looking for him didn't come back.",
  controlsKbm: 'Keyboard & mouse',
  controlsPad: 'Gamepad',
  deviceHint: 'Prompts follow the last device you used.',
};

/** Control prompts and tutorial hints. {key} tokens become button glyphs. */
export const PROMPTS = {
  move: '{move} Move   {look} Look',
  sprint: 'Hold {sprint} to sprint',
  sprintPad: 'Click {sprint} to sprint',
  jump: '{jump} Jump-jet   Hold {jump} in the air to hover',
  dash: '{dash} Dash in any direction',
  talk: '{interact} Talk',
  shoulder: '{swapShoulder} Swap shoulder',
  fire: '{fire} Fire   {aim} Aim',
  cover:
    'No cover button: with your weapon out, move into low walls or pillars to take cover. Aim to pop out. Move away to leave.',
  reload: '{reload} Reload',
  swap: '{swapWeapon} Swap weapon: SMG strips shields, rifle cracks armor',
  powers: '{power1} Ka Snare (primer)   {power2} Ka Lance   {power3} Ka Surge (detonators)',
  combo: 'Snare an enemy, then hit it with Lance or Surge to set off a KA BURST.',
  comboShield: 'Snare is blocked by shields and armor. Strip them first.',
  hover: 'Aim in mid-air to hover and shoot from above',
  mezzanine: 'Jump-jets reach the mezzanine from the speaker stacks',
  heavy: 'Hippos are armored: rifle cracks armor fast. Shoot the glowing pack on its back.',
  rifleRange: 'Long sightlines: the rifle shines here. Aim to scope.',
  melee: '{melee} Melee',
  pickup: 'Walk over ammo crates and med kits to use them',
};

export const OBJECTIVES = {
  dockTalk: `Talk to ${NAMES.contactShort}`,
  dockGate: 'Head through the pylon gate into the strip',
  strip1: "Clear the Crocodile's crew from the strip",
  strip2: `Push through to ${NAMES.club}`,
  stripDoor: `Enter ${NAMES.club}`,
  club: `Clear ${NAMES.club}`,
  clubYaw: `Optional: find ${NAMES.bartenderShort} at the bar`,
  clubExit: 'Take the mezzanine exit to the terraces',
  terrace: 'Climb the terraces',
  terraceGate: `Enter ${NAMES.lair}`,
  boss: `Take down ${NAMES.boss}`,
  bossWave: 'Deal with the reinforcements',
  ledger: 'Find the ledger behind the throne',
};

export const SECTION_NAMES = ['', NAMES.station, 'The Strip', NAMES.club, 'The Terraces', NAMES.lair];

/** Short lines enemies call out, shown as subtitles. */
export const BARKS = {
  spotted: ['There she is.', 'Contact. One woman, armed.', 'Boss said she might come.'],
  flank: ['Going around.', 'Moving left.', 'Get on her side.'],
  heavy: ['Hippo coming through.', 'Make room.'],
  lost: ['Lost her.', 'Where did she go?'],
  primed: ['Something has me!', 'Get me down!'],
  allyDown: ['Man down.', 'They got Osei.', 'She is not playing.'],
};

/** The Crocodile's lines during the fight, shown as subtitles. */
export const BOSS_BARKS = {
  retry: 'Back already. Persistence runs in the family.',
  phase2: 'Shift change. Get in here, all of you.',
  phase3: "Fine. I'll do the paperwork myself.",
  resume: 'Where were we.',
  drag: ['Come here.', 'Closer.', "Don't be shy."],
  lungeWall: ['…Who put that there.'],
  orbs: ['These used to be people. Mind them.'],
  downed: 'Enough. Enough.',
};

export const DIALOGUE: Record<string, DialogueTree> = {
  dock: {
    id: 'dock',
    start: 'start',
    partner: 'odette',
    nodes: {
      start: {
        speaker: 'odette',
        text: "Last train in from the surface. You're either brave or bad with schedules.",
        choices: [
          { text: "I'm on Mari's schedule.", next: 'mari' },
          { text: 'Bit of both.', next: 'both' },
        ],
      },
      both: {
        speaker: 'odette',
        text: "Good. The brave ones don't listen and the punctual ones don't come down here.",
        next: 'mari',
      },
      mari: {
        speaker: 'odette',
        text: 'Three weeks ago she stood right where you are and asked me the questions you\'re about to ask. I gave her the same answers.',
        next: 'mari2',
      },
      mari2: {
        speaker: 'imani',
        text: 'Then give them to me slower.',
        next: 'city',
      },
      city: {
        speaker: 'odette',
        text: 'Neo Atlantis. Two hundred metres of Caribbean over your head, Hispaniola up north, the continent down south. They built it to look like the old temples so people would feel it had always been here.',
        choices: [
          { text: 'Tell me about the district.', next: 'district' },
          { text: 'Tell me about the Crocodile.', next: 'croc' },
          { text: 'Skip the tour.', next: 'favor' },
        ],
      },
      district: {
        speaker: 'odette',
        text: "Hathor's Reach. Named for the goddess of music and joy, so: clubs, bars, noodle stalls, people who came down here to forget the weather. It stays loud because quiet means someone's listening.",
        choices: [
          { text: 'And the Crocodile?', next: 'croc' },
          { text: 'Where would Mari have gone?', next: 'where' },
        ],
      },
      croc: {
        speaker: 'odette',
        text: "Calls himself a creditor. You borrow, you can't pay, his people take your ka-amp instead. Some he sells. The good ones he wires into himself.",
        next: 'croc2',
      },
      croc2: {
        speaker: 'imani',
        text: 'And the people the implants came out of?',
        next: 'croc3',
      },
      croc3: {
        speaker: 'odette',
        text: "They don't come back to complain. He keeps house at the top of the Reach, in the old sacred lake. Drained it. Says he likes the acoustics.",
        choices: [
          { text: 'Where would Mari have gone?', next: 'where' },
          { text: 'What can you give me?', next: 'favor' },
        ],
      },
      where: {
        speaker: 'odette',
        text: "The Sistrum. Club on the strip. Her source tended bar there. If he's still breathing, he's still pouring.",
        next: 'favor',
      },
      favor: {
        speaker: 'odette',
        text: "I can do you one favor. A maintenance code for the Sistrum's service corridor, or the schematic Mari pulled on his rig. Not both. I have a pension to think about.",
        choices: [
          { text: 'The code.', next: 'takeCode', setFlags: ['intel_route'] },
          { text: 'The schematic.', next: 'takeSchematic', setFlags: ['intel_weakpoint'], events: ['intelWeakpoint'] },
        ],
      },
      takeCode: {
        speaker: 'odette',
        text: "Service door's on the east wall of the club. There's a supply cage behind it. Don't tell me what you take.",
        next: 'bye',
      },
      takeSchematic: {
        speaker: 'odette',
        text: 'His rig vents through a reservoir between his shoulders. Mari marked where it runs hot. Pushing it to your implant now.',
        next: 'bye',
      },
      bye: {
        speaker: 'odette',
        text: "His crew works the strip. They'll see you before you see them. Keep low and let the walls do the work.",
        choices: [
          { text: "I'll bring her home.", next: 'endPromise', setFlags: ['promised_odette'] },
          { text: 'Thanks, Odette.', next: 'endThanks' },
        ],
      },
      endPromise: {
        speaker: 'odette',
        text: 'Bring yourself home. Start there.',
        next: null,
        events: ['openStripGate'],
      },
      endThanks: {
        speaker: 'odette',
        text: 'Thank me after.',
        next: null,
        events: ['openStripGate'],
      },
    },
  },

  bartender: {
    id: 'bartender',
    start: 'start',
    partner: 'yaw',
    nodes: {
      start: {
        speaker: 'yaw',
        text: "We're closed. Obviously.",
        setFlags: ['yaw_met'],
        choices: [
          { text: "You're Yaw. Mari's friend.", next: 'mari' },
          { text: 'Pour me something anyway.', next: 'pour' },
        ],
      },
      pour: {
        speaker: 'yaw',
        text: "Water's the only thing not broken. On the house. Everything's on the house tonight; the house is full of holes.",
        next: 'mari',
      },
      mari: {
        speaker: 'yaw',
        text: 'She said if anything happened, someone with her face and worse manners would come asking.',
        next: 'mari2',
      },
      mari2: {
        speaker: 'imani',
        text: 'What happened?',
        next: 'what',
      },
      what: {
        speaker: 'yaw',
        text: 'She found his ledger. Names, dates, which implant came out of who. She went up to the Basin to photograph the rest. Nobody saw her come down.',
        choices: [
          { text: "Why didn't you stop her?", next: 'why', setFlags: ['asked_sister'] },
          { text: 'Is the ledger still up there?', next: 'ledger' },
        ],
      },
      why: {
        speaker: 'yaw',
        text: "Have you met her? You don't stop a tide by standing in it.",
        next: 'ledger',
      },
      ledger: {
        speaker: 'yaw',
        text: 'If it is, it\'s near him. He keeps the things he values close.',
        choices: [
          { text: 'Anything about his rig?', next: 'rig', condition: { flag: 'intel_weakpoint', is: false }, setFlags: ['intel_weakpoint'], events: ['intelWeakpoint'] },
          { text: 'Is there another way up through the club?', next: 'route', condition: { flag: 'intel_route', is: false }, setFlags: ['intel_route'], events: ['openSideRoute'] },
          { text: 'Get out of the district. Tonight.', next: 'leave', setFlags: ['yaw_left'] },
          { text: "Stay down. I'll be back.", next: 'stay' },
        ],
      },
      rig: {
        speaker: 'yaw',
        text: 'There\'s a reservoir between his shoulders. When he pushes too hard it glows. Mari said that\'s where it would crack.',
        next: 'after',
      },
      route: {
        speaker: 'yaw',
        text: "Service door, east wall. Code's one-one-one-one. I'm not a creative man. There's a supply cage in there.",
        next: 'after',
      },
      after: {
        speaker: 'yaw',
        text: "Anything else, I don't know. If I did, I'd be braver.",
        choices: [
          { text: 'Get out of the district. Tonight.', next: 'leave', setFlags: ['yaw_left'] },
          { text: "Stay down. I'll be back.", next: 'stay' },
        ],
      },
      leave: {
        speaker: 'yaw',
        text: "The last train's gone.",
        next: 'leave2',
      },
      leave2: {
        speaker: 'imani',
        text: 'Odette runs the dock. Tell her I sent you. She\'ll find you a seat on the first one out.',
        next: 'leave3',
      },
      leave3: {
        speaker: 'yaw',
        text: '…All right. Thank you.',
        next: null,
        events: ['yawLeaves'],
      },
      stay: {
        speaker: 'yaw',
        text: "I've been staying down for three years. I'm good at it.",
        next: null,
      },
    },
  },

  bossIntro: {
    id: 'bossIntro',
    start: 'start',
    partner: 'croc',
    nodes: {
      start: {
        speaker: 'croc',
        text: 'Cruz. You have her jaw. She had better posture.',
        choices: [
          { text: 'Where is she?', next: 'where', setFlags: ['asked_sister'] },
          { text: 'You talk a lot for a reptile.', next: 'reptile' },
          { text: '[Say nothing.]', next: 'silent' },
        ],
      },
      where: {
        speaker: 'croc',
        text: 'Where everyone ends up who audits me. On the books.',
        next: 'offer',
      },
      reptile: {
        speaker: 'croc',
        text: "Crocodiles don't talk. That's what makes us good at business.",
        next: 'offer',
      },
      silent: {
        speaker: 'croc',
        text: 'The quiet type. Your sister was not the quiet type.',
        next: 'offer',
      },
      offer: {
        speaker: 'croc',
        text: 'That implant in your neck is a prototype. Worth more than this whole district. Hand it over and you walk out with your heart still doing what hearts do.',
        branches: [{ condition: { flag: 'intel_weakpoint' }, next: 'weak' }],
        next: 'answer',
      },
      weak: {
        speaker: 'imani',
        text: '(The reservoir between his shoulders is already running hot. Thanks, Mari.)',
        next: 'answer',
      },
      answer: {
        speaker: 'croc',
        text: 'Well?',
        choices: [
          { text: 'Come and take it.', next: 'fight' },
          { text: "Here's my counteroffer.", next: 'counter' },
        ],
      },
      fight: {
        speaker: 'croc',
        text: 'I always do.',
        next: null,
        events: ['startBoss'],
      },
      counter: {
        speaker: 'croc',
        text: 'Counteroffer noted.',
        next: null,
        events: ['startBoss'],
      },
    },
  },

  bossOutro: {
    id: 'bossOutro',
    start: 'start',
    partner: 'croc',
    nodes: {
      start: {
        speaker: 'croc',
        text: 'Look at that. A Cruz who finishes things.',
        next: 'ledger',
      },
      ledger: {
        speaker: 'imani',
        text: 'The ledger.',
        next: 'ledger2',
      },
      ledger2: {
        speaker: 'croc',
        text: 'Behind the throne. Your sister found it first. She was writing in it when my people found her.',
        choices: [
          { text: 'Is she alive?', next: 'alive' },
          { text: 'What did she write?', next: 'read' },
        ],
      },
      alive: {
        speaker: 'croc',
        text: 'Ask the sea. It kept her.',
        next: 'read',
      },
      read: {
        speaker: 'imani',
        text: "(Two hundred names. Every account marked closed in the same careful hand. The last line: 'Mimi, if you're reading this, you're late. Get them home.')",
        next: 'choice',
      },
      choice: {
        speaker: 'croc',
        text: 'Those implants keep me breathing now. Take them and you take me. So. What does a Cruz do?',
        choices: [
          { text: 'The Dome Authority can have you.', next: 'spare', setFlags: ['croc_spared'] },
          { text: 'Shut the rig down. Every stolen implant.', next: 'shutdown', setFlags: ['croc_shutdown'] },
        ],
      },
      spare: {
        speaker: 'imani',
        text: "You'll get a cell with a view of the water. Mari would have wanted a trial.",
        next: 'spare2',
      },
      spare2: {
        speaker: 'croc',
        text: 'Your sister would have wanted a lot of things.',
        next: null,
        events: ['endLevel'],
      },
      shutdown: {
        speaker: 'imani',
        text: "They're not yours. They never were.",
        next: 'shutdown2',
      },
      shutdown2: {
        speaker: 'croc',
        text: '…Cold. She was warmer.',
        next: null,
        events: ['endLevel'],
      },
    },
  },
};

/** End screen paragraphs; each is shown if its condition holds. */
export const END_TEXT: { flag?: string; not?: string; text: string }[] = [
  { text: "Hathor's Reach goes quiet for the first time in three years. Then, around six, someone puts music back on." },
  { flag: 'croc_spared', text: 'The Crocodile goes up the line in restraints, still talking. The Dome Authority gets a ledger with two hundred names in it.' },
  { flag: 'croc_shutdown', text: 'The stolen implants go dark one by one. The Dome Authority finds the Crocodile sitting in his drained lake, very quiet, and a ledger with two hundred names in it.' },
  { flag: 'yaw_left', text: 'Yaw Mensah is on the first train out. Odette gives him the window seat.' },
  { flag: 'yaw_met', not: 'yaw_left', text: 'Yaw Mensah reopens the Sistrum a week later. He pours the first drink for an empty stool.' },
  { flag: 'promised_odette', text: 'Odette meets the last train in. She does not ask about the promise. Imani does not make her.' },
  { text: "Imani keeps the last page. The handwriting is her sister's, and it is, for once, the final word." },
];
