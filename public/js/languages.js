/**
 * Global Languages Database (100+ World Languages)
 * Grouped by Region with Native Names, Flags, and Language Codes
 */

export const REGIONS = {
  POPULAR: '🔥 Most Popular',
  INDIAN: '🇮🇳 Indian Languages',
  EUROPEAN: '🇪🇺 European',
  ASIAN: '🌏 Asian & Pacific',
  MIDDLE_EAST_AFRICA: '🌍 Middle East & Africa',
  AMERICAS: '🌎 Americas',
};

export const LANGUAGES = [
  // Most Popular Global
  { code: 'en', name: 'English', nativeName: 'English', flag: '🇺🇸', region: REGIONS.POPULAR },
  { code: 'es', name: 'Spanish', nativeName: 'Español', flag: '🇪🇸', region: REGIONS.POPULAR },
  { code: 'hi', name: 'Hindi', nativeName: 'हिन्दी', flag: '🇮🇳', region: REGIONS.POPULAR },
  { code: 'zh', name: 'Chinese (Simplified)', nativeName: '简体中文', flag: '🇨🇳', region: REGIONS.POPULAR },
  { code: 'ar', name: 'Arabic', nativeName: 'العربية', flag: '🇸🇦', region: REGIONS.POPULAR },
  { code: 'fr', name: 'French', nativeName: 'Français', flag: '🇫🇷', region: REGIONS.POPULAR },
  { code: 'pt', name: 'Portuguese', nativeName: 'Português', flag: '🇧🇷', region: REGIONS.POPULAR },
  { code: 'ru', name: 'Russian', nativeName: 'Русский', flag: '🇷🇺', region: REGIONS.POPULAR },
  { code: 'de', name: 'German', nativeName: 'Deutsch', flag: '🇩🇪', region: REGIONS.POPULAR },
  { code: 'ja', name: 'Japanese', nativeName: '日本語', flag: '🇯🇵', region: REGIONS.POPULAR },
  { code: 'ko', name: 'Korean', nativeName: '한국어', flag: '🇰🇷', region: REGIONS.POPULAR },
  { code: 'it', name: 'Italian', nativeName: 'Italiano', flag: '🇮🇹', region: REGIONS.POPULAR },

  // Indian Languages (High demand in India & Diaspora)
  { code: 'ta', name: 'Tamil', nativeName: 'தமிழ்', flag: '🇮🇳', region: REGIONS.INDIAN },
  { code: 'te', name: 'Telugu', nativeName: 'తెలుగు', flag: '🇮🇳', region: REGIONS.INDIAN },
  { code: 'kn', name: 'Kannada', nativeName: 'ಕನ್ನಡ', flag: '🇮🇳', region: REGIONS.INDIAN },
  { code: 'ml', name: 'Malayalam', nativeName: 'മലയാളം', flag: '🇮🇳', region: REGIONS.INDIAN },
  { code: 'bn', name: 'Bengali', nativeName: 'বাংলা', flag: '🇧🇩', region: REGIONS.INDIAN },
  { code: 'mr', name: 'Marathi', nativeName: 'मराठी', flag: '🇮🇳', region: REGIONS.INDIAN },
  { code: 'gu', name: 'Gujarati', nativeName: 'ગુજરાતી', flag: '🇮🇳', region: REGIONS.INDIAN },
  { code: 'pa', name: 'Punjabi', nativeName: 'ਪੰਜਾਬੀ', flag: '🇮🇳', region: REGIONS.INDIAN },
  { code: 'ur', name: 'Urdu', nativeName: 'اردو', flag: '🇵🇰', region: REGIONS.INDIAN },
  { code: 'or', name: 'Odia', nativeName: 'ଓଡ଼ିଆ', flag: '🇮🇳', region: REGIONS.INDIAN },
  { code: 'as', name: 'Assamese', nativeName: 'অসমীয়া', flag: '🇮🇳', region: REGIONS.INDIAN },
  { code: 'sa', name: 'Sanskrit', nativeName: 'संस्कृतम्', flag: '🇮🇳', region: REGIONS.INDIAN },
  { code: 'ne', name: 'Nepali', nativeName: 'नेपाली', flag: '🇳🇵', region: REGIONS.INDIAN },
  { code: 'si', name: 'Sinhala', nativeName: 'සිංහල', flag: '🇱🇰', region: REGIONS.INDIAN },

  // European Languages
  { code: 'nl', name: 'Dutch', nativeName: 'Nederlands', flag: '🇳🇱', region: REGIONS.EUROPEAN },
  { code: 'el', name: 'Greek', nativeName: 'Ελληνικά', flag: '🇬🇷', region: REGIONS.EUROPEAN },
  { code: 'pl', name: 'Polish', nativeName: 'Polski', flag: '🇵🇱', region: REGIONS.EUROPEAN },
  { code: 'sv', name: 'Swedish', nativeName: 'Svenska', flag: '🇸🇪', region: REGIONS.EUROPEAN },
  { code: 'no', name: 'Norwegian', nativeName: 'Norsk', flag: '🇳🇴', region: REGIONS.EUROPEAN },
  { code: 'da', name: 'Danish', nativeName: 'Dansk', flag: '🇩🇰', region: REGIONS.EUROPEAN },
  { code: 'fi', name: 'Finnish', nativeName: 'Suomi', flag: '🇫🇮', region: REGIONS.EUROPEAN },
  { code: 'cs', name: 'Czech', nativeName: 'Čeština', flag: '🇨🇿', region: REGIONS.EUROPEAN },
  { code: 'ro', name: 'Romanian', nativeName: 'Română', flag: '🇷🇴', region: REGIONS.EUROPEAN },
  { code: 'hu', name: 'Hungarian', nativeName: 'Magyar', flag: '🇭🇺', region: REGIONS.EUROPEAN },
  { code: 'uk', name: 'Ukrainian', nativeName: 'Українська', flag: '🇺🇦', region: REGIONS.EUROPEAN },
  { code: 'bg', name: 'Bulgarian', nativeName: 'Български', flag: '🇧🇬', region: REGIONS.EUROPEAN },
  { code: 'hr', name: 'Croatian', nativeName: 'Hrvatski', flag: '🇭🇷', region: REGIONS.EUROPEAN },
  { code: 'sk', name: 'Slovak', nativeName: 'Slovenčina', flag: '🇸🇰', region: REGIONS.EUROPEAN },
  { code: 'sr', name: 'Serbian', nativeName: 'Српски', flag: '🇷🇸', region: REGIONS.EUROPEAN },
  { code: 'sl', name: 'Slovenian', nativeName: 'Slovenščina', flag: '🇸🇮', region: REGIONS.EUROPEAN },
  { code: 'lt', name: 'Lithuanian', nativeName: 'Lietuvių', flag: '🇱🇹', region: REGIONS.EUROPEAN },
  { code: 'lv', name: 'Latvian', nativeName: 'Latviešu', flag: '🇱🇻', region: REGIONS.EUROPEAN },
  { code: 'et', name: 'Estonian', nativeName: 'Eesti', flag: '🇪🇪', region: REGIONS.EUROPEAN },
  { code: 'is', name: 'Icelandic', nativeName: 'Íslenska', flag: '🇮🇸', region: REGIONS.EUROPEAN },
  { code: 'ga', name: 'Irish', nativeName: 'Gaeilge', flag: '🇮🇪', region: REGIONS.EUROPEAN },
  { code: 'sq', name: 'Albanian', nativeName: 'Shqip', flag: '🇦🇱', region: REGIONS.EUROPEAN },
  { code: 'mk', name: 'Macedonian', nativeName: 'Македонски', flag: '🇲🇰', region: REGIONS.EUROPEAN },
  { code: 'mt', name: 'Maltese', nativeName: 'Malti', flag: '🇲🇹', region: REGIONS.EUROPEAN },
  { code: 'bs', name: 'Bosnian', nativeName: 'Bosanski', flag: '🇧🇦', region: REGIONS.EUROPEAN },
  { code: 'ca', name: 'Catalan', nativeName: 'Català', flag: '🇪🇸', region: REGIONS.EUROPEAN },
  { code: 'gl', name: 'Galician', nativeName: 'Galego', flag: '🇪🇸', region: REGIONS.EUROPEAN },
  { code: 'eu', name: 'Basque', nativeName: 'Euskara', flag: '🇪🇸', region: REGIONS.EUROPEAN },
  { code: 'cy', name: 'Welsh', nativeName: 'Cymraeg', flag: '🏴󠁧󠁢󠁷󠁬󠁳󠁿', region: REGIONS.EUROPEAN },
  { code: 'lb', name: 'Luxembourgish', nativeName: 'Lëtzebuergesch', flag: '🇱🇺', region: REGIONS.EUROPEAN },
  { code: 'be', name: 'Belarusian', nativeName: 'Беларуская', flag: '🇧🇾', region: REGIONS.EUROPEAN },

  // Asian & Pacific Languages
  { code: 'id', name: 'Indonesian', nativeName: 'Bahasa Indonesia', flag: '🇮🇩', region: REGIONS.ASIAN },
  { code: 'ms', name: 'Malay', nativeName: 'Bahasa Melayu', flag: '🇲🇾', region: REGIONS.ASIAN },
  { code: 'vi', name: 'Vietnamese', nativeName: 'Tiếng Việt', flag: '🇻🇳', region: REGIONS.ASIAN },
  { code: 'th', name: 'Thai', nativeName: 'ไทย', flag: '🇹🇭', region: REGIONS.ASIAN },
  { code: 'tl', name: 'Filipino / Tagalog', nativeName: 'Wikang Filipino', flag: '🇵🇭', region: REGIONS.ASIAN },
  { code: 'my', name: 'Burmese', nativeName: 'မြန်မာစာ', flag: '🇲🇲', region: REGIONS.ASIAN },
  { code: 'km', name: 'Khmer', nativeName: 'ភាសាខ្មែរ', flag: '🇰🇭', region: REGIONS.ASIAN },
  { code: 'lo', name: 'Lao', nativeName: 'ພາສາລາວ', flag: '🇱🇦', region: REGIONS.ASIAN },
  { code: 'mn', name: 'Mongolian', nativeName: 'Монгол хэл', flag: '🇲🇳', region: REGIONS.ASIAN },
  { code: 'kk', name: 'Kazakh', nativeName: 'Қазақ тілі', flag: '🇰🇿', region: REGIONS.ASIAN },
  { code: 'uz', name: 'Uzbek', nativeName: 'Oʻzbekcha', flag: '🇺🇿', region: REGIONS.ASIAN },
  { code: 'az', name: 'Azerbaijani', nativeName: 'Azərbaycan', flag: '🇦🇿', region: REGIONS.ASIAN },
  { code: 'ka', name: 'Georgian', nativeName: 'ქართული', flag: '🇬🇪', region: REGIONS.ASIAN },
  { code: 'hy', name: 'Armenian', nativeName: 'Հայերեն', flag: '🇦🇲', region: REGIONS.ASIAN },
  { code: 'tg', name: 'Tajik', nativeName: 'Тоҷикӣ', flag: '🇹🇯', region: REGIONS.ASIAN },
  { code: 'ky', name: 'Kyrgyz', nativeName: 'Кыргызча', flag: '🇰🇬', region: REGIONS.ASIAN },
  { code: 'ps', name: 'Pashto', nativeName: 'پښتو', flag: '🇦🇫', region: REGIONS.ASIAN },
  { code: 'sm', name: 'Samoan', nativeName: 'Gagana Samoa', flag: '🇼🇸', region: REGIONS.ASIAN },
  { code: 'mi', name: 'Maori', nativeName: 'Te Reo Māori', flag: '🇳🇿', region: REGIONS.ASIAN },
  { code: 'haw', name: 'Hawaiian', nativeName: 'ʻŌlelo Hawaiʻi', flag: '🌺', region: REGIONS.ASIAN },

  // Middle East & Africa
  { code: 'tr', name: 'Turkish', nativeName: 'Türkçe', flag: '🇹🇷', region: REGIONS.MIDDLE_EAST_AFRICA },
  { code: 'fa', name: 'Persian (Farsi)', nativeName: 'فارسی', flag: '🇮🇷', region: REGIONS.MIDDLE_EAST_AFRICA },
  { code: 'he', name: 'Hebrew', nativeName: 'עברית', flag: '🇮🇱', region: REGIONS.MIDDLE_EAST_AFRICA },
  { code: 'sw', name: 'Swahili', nativeName: 'Kiswahili', flag: '🇰🇪', region: REGIONS.MIDDLE_EAST_AFRICA },
  { code: 'am', name: 'Amharic', nativeName: 'አማርኛ', flag: '🇪🇹', region: REGIONS.MIDDLE_EAST_AFRICA },
  { code: 'yo', name: 'Yoruba', nativeName: 'Èdè Yorùbá', flag: '🇳🇬', region: REGIONS.MIDDLE_EAST_AFRICA },
  { code: 'ig', name: 'Igbo', nativeName: 'Asụsụ Igbo', flag: '🇳🇬', region: REGIONS.MIDDLE_EAST_AFRICA },
  { code: 'ha', name: 'Hausa', nativeName: 'Harshen Hausa', flag: '🇳🇬', region: REGIONS.MIDDLE_EAST_AFRICA },
  { code: 'zu', name: 'Zulu', nativeName: 'isiZulu', flag: '🇿🇦', region: REGIONS.MIDDLE_EAST_AFRICA },
  { code: 'xh', name: 'Xhosa', nativeName: 'isiXhosa', flag: '🇿🇦', region: REGIONS.MIDDLE_EAST_AFRICA },
  { code: 'af', name: 'Afrikaans', nativeName: 'Afrikaans', flag: '🇿🇦', region: REGIONS.MIDDLE_EAST_AFRICA },
  { code: 'so', name: 'Somali', nativeName: 'Af Soomaali', flag: '🇸🇴', region: REGIONS.MIDDLE_EAST_AFRICA },
  { code: 'rw', name: 'Kinyarwanda', nativeName: 'Ikinyarwanda', flag: '🇷🇼', region: REGIONS.MIDDLE_EAST_AFRICA },
  { code: 'sn', name: 'Shona', nativeName: 'chiShona', flag: '🇿🇼', region: REGIONS.MIDDLE_EAST_AFRICA },
  { code: 'mg', name: 'Malagasy', nativeName: 'Fiteny Malagasy', flag: '🇲🇬', region: REGIONS.MIDDLE_EAST_AFRICA },
  { code: 'ku', name: 'Kurdish', nativeName: 'Kurdî', flag: '☀️', region: REGIONS.MIDDLE_EAST_AFRICA },

  // Americas & Indigenous
  { code: 'ht', name: 'Haitian Creole', nativeName: 'Kreyòl Ayisyen', flag: '🇭🇹', region: REGIONS.AMERICAS },
  { code: 'qu', name: 'Quechua', nativeName: 'Runa Simi', flag: '🇵🇪', region: REGIONS.AMERICAS },
  { code: 'gn', name: 'Guarani', nativeName: 'Avañeʼẽ', flag: '🇵🇾', region: REGIONS.AMERICAS },
  { code: 'ay', name: 'Aymara', nativeName: 'Aymar aru', flag: '🇧🇴', region: REGIONS.AMERICAS },
  { code: 'eo', name: 'Esperanto', nativeName: 'Esperanto', flag: '🌐', region: REGIONS.AMERICAS },
  { code: 'la', name: 'Latin', nativeName: 'Latīna', flag: '🏛️', region: REGIONS.AMERICAS },
];

export function getLanguageByCode(code) {
  return LANGUAGES.find(l => l.code === code) || {
    code,
    name: code.toUpperCase(),
    nativeName: code.toUpperCase(),
    flag: '🌐',
    region: 'Other',
  };
}

export function searchLanguages(query) {
  if (!query) return LANGUAGES;
  const q = query.toLowerCase().trim();
  return LANGUAGES.filter(
    l =>
      l.name.toLowerCase().includes(q) ||
      l.nativeName.toLowerCase().includes(q) ||
      l.code.toLowerCase().includes(q)
  );
}
