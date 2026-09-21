/**
 * modes.js
 * -----------------------------------------------------------------------
 * JavaScript port of the Python project's modes.py. This is the SAME data
 * -- same class labels, same English/Arabic display text, same tips --
 * just written so the web app can use it. If you edit modes.py (add a
 * class, change a label, tweak a tip), copy the change here too, or the
 * desktop app and the phone app will disagree with each other.
 *
 * Labels (the `label` field) MUST exactly match the folder names / class
 * names produced by the Python pipeline (collect_imgs.py, create_dataset.py,
 * train_classifier.py), because convert_models_to_js.py reads the trained
 * model's own class list -- it does not use this file to decide label
 * names. This file is only for what to SHOW on screen for each label.
 */

const ASL_CLASSES = [
  ...'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('').map((c) => ({ label: c, displayEn: c, displayAr: null, tip: null })),
  ...'0123456789'.split('').map((d) => ({ label: d, displayEn: d, displayAr: null, tip: null })),
];

// Columns: label, English name, the letter to SHOW, the words to SPEAK in Arabic.
//
// The fourth column exists because of a real bug: we used to hand the bare
// letter -- "ا" -- straight to the phone's Arabic voice, and text-to-speech
// engines say nothing at all for a lone letter glyph. On screen you want the
// letter; out loud you want its NAME ("ألف"). Same reason the digits below
// speak as words rather than as the numeral "٠".
const ARABIC_LETTERS = [
  ['alef', 'Alef', 'ا', 'ألف'], ['baa', 'Baa', 'ب', 'باء'], ['taa', 'Taa', 'ت', 'تاء'],
  ['thaa', 'Thaa', 'ث', 'ثاء'], ['jeem', 'Jeem', 'ج', 'جيم'], ['haa', 'Haa', 'ح', 'حاء'],
  ['khaa', 'Khaa', 'خ', 'خاء'], ['dal', 'Dal', 'د', 'دال'], ['thal', 'Thal', 'ذ', 'ذال'],
  ['raa', 'Raa', 'ر', 'راء'], ['zay', 'Zay', 'ز', 'زاي'], ['seen', 'Seen', 'س', 'سين'],
  ['sheen', 'Sheen', 'ش', 'شين'], ['sad', 'Sad', 'ص', 'صاد'], ['dad', 'Dad', 'ض', 'ضاد'],
  ['tah', 'Tah', 'ط', 'طاء'], ['zah', 'Zah', 'ظ', 'ظاء'], ['ain', 'Ain', 'ع', 'عين'],
  ['ghain', 'Ghain', 'غ', 'غين'], ['faa', 'Faa', 'ف', 'فاء'], ['qaf', 'Qaf', 'ق', 'قاف'],
  ['kaf', 'Kaf', 'ك', 'كاف'], ['lam', 'Lam', 'ل', 'لام'], ['meem', 'Meem', 'م', 'ميم'],
  ['noon', 'Noon', 'ن', 'نون'], ['heh', 'Heh', 'ه', 'هاء'], ['waw', 'Waw', 'و', 'واو'],
  ['yaa', 'Yaa', 'ي', 'ياء'],
];
const ARABIC_INDIC_DIGITS = '٠١٢٣٤٥٦٧٨٩'; // U+0660..U+0669, index === digit value
const ARABIC_DIGIT_WORDS = [
  'صفر', 'واحد', 'اثنان', 'ثلاثة', 'أربعة', 'خمسة', 'ستة', 'سبعة', 'ثمانية', 'تسعة',
];

const ARSL_CLASSES = [
  ...ARABIC_LETTERS.map(([label, en, ar, sayAr]) => ({
    label, displayEn: en, displayAr: ar, speakAr: sayAr, tip: null,
  })),
  ...Array.from({ length: 10 }, (_, d) => ({
    label: `raqm${d}`, displayEn: String(d), displayAr: ARABIC_INDIC_DIGITS[d],
    speakAr: ARABIC_DIGIT_WORDS[d], tip: null,
  })),
];

// Each word is one held ASL handshape, so a whole word is a single sign
// instead of being spelled out letter by letter. The fourth column is that
// handshape -- shown in the app as a tip, and used by
// build_needs_from_asl.py to assemble the training photos from data/ASL/.
// Keep this list in step with _NEEDS in ../modes.py.
const NEEDS_RAW = [
  ['water', 'Water', 'ماء', 'W'],
  ['food', 'Food', 'طعام', 'F'],
  ['help', 'Help', 'مساعدة', 'K'],
  ['pain', 'Pain', 'ألم', 'P'],
  ['doctor', 'Doctor', 'طبيب', 'D'],
  ['medicine', 'Medicine', 'دواء', 'L'],
  ['bathroom', 'Bathroom', 'حمام', 'B'],
  ['yes', 'Yes', 'نعم', 'S'],
  ['no', 'No', 'لا', 'X'],
  ['thankyou', 'Thank You', 'شكراً', 'G'],
  ['please', 'Please', 'من فضلك', 'R'],
  ['sorry', 'Sorry', 'آسف', 'I'],
  ['wait', 'Wait', 'انتظر', '5'],
  ['stop', 'Stop', 'توقف', '4'],
  ['where', 'Where', 'أين', 'V'],
  ['family', 'Family', 'عائلة', 'C'],
  ['money', 'Money', 'مال', 'O'],
  ['phone', 'Phone', 'هاتف', 'Y'],
  ['tired', 'Tired', 'تعب', '7'],
  ['emergency', 'Emergency', 'طوارئ', '8'],
];
const NEEDS_CLASSES = NEEDS_RAW.map(([label, en, ar, shape]) => ({
  label, displayEn: en, displayAr: ar, tip: `Hold the ASL "${shape}" handshape`,
}));

const ETIQUETTE_RAW = [
  ['heart', 'Hand Over Heart', 'اليد على القلب',
    'Placing your right hand over your heart is a warm, respectful way to greet someone or say thank you in the UAE, especially when a handshake is not appropriate.'],
  ['right_hand', 'Right-Hand Giving', 'اليد اليمنى',
    'It is customary in the UAE to give and receive items -- and to shake hands -- using the right hand.'],
  ['thumbsup', 'Thumbs Up', 'إبهام لأعلى',
    'A thumbs-up is a friendly, positive gesture in the UAE.'],
  ['palmwait', 'Please Wait', 'انتظر من فضلك',
    'An open palm facing outward is a polite way to ask someone to wait a moment.'],
  ['beckon', 'Beckoning Someone Over', 'تعال من فضلك',
    'When calling someone over, a palm-down waving motion is generally seen as more polite than palm-up beckoning across much of the Gulf region.'],
];
const ETIQUETTE_CLASSES = ETIQUETTE_RAW.map(([label, en, ar, tip]) => ({ label, displayEn: en, displayAr: ar, tip }));

export const MODES = [
  {
    id: 'asl', key: '1',
    nameEn: 'American Sign Language', nameAr: 'لغة الإشارة الأمريكية',
    description: 'Fingerspelled ASL alphabet (A-Z) and digits (0-9).',
    classes: ASL_CLASSES,
  },
  {
    id: 'arsl', key: '2',
    nameEn: 'Arabic Sign Language', nameAr: 'لغة الإشارة العربية',
    description: 'Arabic manual alphabet (28 letters) and Arabic-Indic numerals (0-9).',
    classes: ARSL_CLASSES,
  },
  {
    id: 'needs', key: '3',
    nameEn: 'Essential Needs', nameAr: 'الاحتياجات الأساسية',
    description: 'One held handshape per word -- ask for water, help or a doctor with a single sign.',
    classes: NEEDS_CLASSES,
  },
  {
    id: 'etiquette', key: '4',
    nameEn: 'UAE Etiquette Gestures', nameAr: 'آداب التحية الإماراتية',
    description: 'Common Gulf/Emirati greeting gestures with a cultural tip for each.',
    classes: ETIQUETTE_CLASSES,
  },
];

export const MODES_BY_ID = Object.fromEntries(MODES.map((m) => [m.id, m]));

/** Look up display info for a predicted label within a given mode. */
export function lookupClass(mode, label) {
  return mode.classes.find((c) => c.label === label) || null;
}
