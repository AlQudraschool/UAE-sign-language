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

const ARABIC_LETTERS = [
  ['alef', 'Alef', 'ا'], ['baa', 'Baa', 'ب'], ['taa', 'Taa', 'ت'],
  ['thaa', 'Thaa', 'ث'], ['jeem', 'Jeem', 'ج'], ['haa', 'Haa', 'ح'],
  ['khaa', 'Khaa', 'خ'], ['dal', 'Dal', 'د'], ['thal', 'Thal', 'ذ'],
  ['raa', 'Raa', 'ر'], ['zay', 'Zay', 'ز'], ['seen', 'Seen', 'س'],
  ['sheen', 'Sheen', 'ش'], ['sad', 'Sad', 'ص'], ['dad', 'Dad', 'ض'],
  ['tah', 'Tah', 'ط'], ['zah', 'Zah', 'ظ'], ['ain', 'Ain', 'ع'],
  ['ghain', 'Ghain', 'غ'], ['faa', 'Faa', 'ف'], ['qaf', 'Qaf', 'ق'],
  ['kaf', 'Kaf', 'ك'], ['lam', 'Lam', 'ل'], ['meem', 'Meem', 'م'],
  ['noon', 'Noon', 'ن'], ['heh', 'Heh', 'ه'], ['waw', 'Waw', 'و'],
  ['yaa', 'Yaa', 'ي'],
];
const ARABIC_INDIC_DIGITS = '٠١٢٣٤٥٦٧٨٩'; // U+0660..U+0669, index === digit value

const ARSL_CLASSES = [
  ...ARABIC_LETTERS.map(([label, en, ar]) => ({ label, displayEn: en, displayAr: ar, tip: null })),
  ...Array.from({ length: 10 }, (_, d) => ({
    label: `raqm${d}`, displayEn: String(d), displayAr: ARABIC_INDIC_DIGITS[d], tip: null,
  })),
];

const NEEDS_RAW = [
  ['water', 'Water', 'ماء'],
  ['help', 'Help', 'مساعدة'],
  ['pain', 'Pain', 'ألم'],
  ['bathroom', 'Bathroom', 'حمام'],
  ['yes', 'Yes', 'نعم'],
  ['no', 'No', 'لا'],
  ['thankyou', 'Thank You', 'شكراً'],
  ['wait', 'Wait', 'انتظر'],
  ['doctor', 'Doctor', 'طبيب'],
  // Everyday conversational phrases -- added so Conversation mode can send
  // a whole common phrase as ONE sign instead of fingerspelling it.
  ['hello', 'Hello', 'مرحباً'],
  ['howareyou', 'How Are You', 'كيف حالك'],
  ['imfine', 'I Am Fine', 'أنا بخير'],
  ['nicetomeetyou', 'Nice To Meet You', 'تشرفنا'],
  ['goodbye', 'Goodbye', 'مع السلامة'],
];
const NEEDS_CLASSES = NEEDS_RAW.map(([label, en, ar]) => ({ label, displayEn: en, displayAr: ar, tip: null }));

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
    description: 'A small, easy-to-learn gesture set for urgent needs and everyday conversation.',
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
