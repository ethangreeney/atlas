/** Country name (exactly as in the deck) -> BCP-47 language tag whose native pronunciation best suits the capital name. */
export const CAPITAL_LANG: Record<string, string> = {
  Abkhazia: 'ru-RU', // Sukhumi: Russian is the de facto administrative language
  Afghanistan: 'fa-IR', // Dari is a Persian variety
  'Åland Islands': 'sv-SE',
  Albania: 'en-US', // no Albanian voice ships anywhere
  Algeria: 'ar-SA',
  Andorra: 'ca-ES', // Catalan is the sole official language
  Angola: 'pt-PT',
  'Antigua and Barbuda': 'en-GB',
  Argentina: 'es-MX',
  Armenia: 'ru-RU', // Armenian voices are rare; Russian renders Yerevan well
  Aruba: 'nl-NL',
  Australia: 'en-AU',
  Austria: 'de-DE',
  Azerbaijan: 'tr-TR', // no Azerbaijani voice; Turkish is closest
  Bahrain: 'ar-SA',
  Bangladesh: 'bn-BD',
  Barbados: 'en-GB',
  Belarus: 'ru-RU', // no Belarusian voice
  Belgium: 'fr-FR', // Brussels is bilingual; French is the majority city language
  Belize: 'en-GB',
  Benin: 'fr-FR',
  Bhutan: 'en-US', // no Dzongkha voice
  Bolivia: 'es-MX',
  'Bosnia and Herzegovina': 'hr-HR', // Croatian voice covers Bosnian phonology
  Botswana: 'en-GB',
  Brazil: 'pt-BR',
  Brunei: 'ms-MY',
  Bulgaria: 'bg-BG',
  'Burkina Faso': 'fr-FR',
  Burundi: 'fr-FR', // no Kirundi voice
  Cambodia: 'km-KH',
  Cameroon: 'fr-FR',
  Canada: 'en-CA',
  'Cape Verde': 'pt-PT',
  'Central African Republic': 'fr-FR',
  Chad: 'fr-FR',
  Chile: 'es-MX',
  China: 'zh-CN',
  Colombia: 'es-MX',
  Comoros: 'fr-FR',
  'Cook Islands': 'en-NZ',
  'Costa Rica': 'es-MX',
  Croatia: 'hr-HR',
  Cuba: 'es-MX',
  Curaçao: 'nl-NL',
  Cyprus: 'el-GR',
  'Czech Republic': 'cs-CZ',
  'Democratic Republic of the Congo': 'fr-FR',
  Denmark: 'da-DK',
  Djibouti: 'fr-FR',
  Dominica: 'en-GB',
  'Dominican Republic': 'es-MX',
  Ecuador: 'es-MX',
  Egypt: 'ar-SA',
  'El Salvador': 'es-MX',
  England: 'en-GB',
  'Equatorial Guinea': 'es-ES', // Spanish there is peninsular, not Latin American
  Eritrea: 'en-US', // no Tigrinya voice
  Estonia: 'et-EE',
  Eswatini: 'en-GB',
  Ethiopia: 'am-ET',
  'Faroe Islands': 'da-DK', // no Faroese voice
  'Federated States of Micronesia': 'en-US',
  Fiji: 'en-GB',
  Finland: 'fi-FI',
  France: 'fr-FR',
  'French Polynesia': 'fr-FR',
  Gabon: 'fr-FR',
  Georgia: 'ka-GE',
  Germany: 'de-DE',
  Ghana: 'en-GB',
  Greece: 'el-GR',
  Greenland: 'da-DK', // no Greenlandic voice; Nuuk is Danish-rendered
  Grenada: 'en-GB',
  Guam: 'en-US',
  Guatemala: 'es-MX',
  Guinea: 'fr-FR',
  'Guinea-Bissau': 'pt-PT',
  Guyana: 'en-GB',
  Haiti: 'fr-FR', // no Haitian Creole voice
  Honduras: 'es-MX',
  Hungary: 'hu-HU',
  Iceland: 'is-IS',
  India: 'en-IN',
  Indonesia: 'id-ID',
  Iran: 'fa-IR',
  Iraq: 'ar-SA',
  Ireland: 'en-IE',
  Israel: 'he-IL',
  Italy: 'it-IT',
  'Ivory Coast': 'fr-FR',
  Jamaica: 'en-GB',
  Japan: 'ja-JP',
  Jordan: 'ar-SA',
  Kazakhstan: 'ru-RU', // no Kazakh voice
  Kenya: 'sw-KE',
  Kiribati: 'en-GB',
  Kosovo: 'en-US', // no Albanian voice
  Kuwait: 'ar-SA',
  Kyrgyzstan: 'ru-RU', // no Kyrgyz voice
  Laos: 'fr-FR', // no Lao voice; Vientiane is a French transliteration
  Latvia: 'lv-LV',
  Lebanon: 'ar-SA',
  Lesotho: 'en-GB',
  Liberia: 'en-US',
  Libya: 'ar-SA',
  Liechtenstein: 'de-DE',
  Lithuania: 'lt-LT',
  Luxembourg: 'fr-FR', // no Luxembourgish voice
  Madagascar: 'fr-FR',
  Malawi: 'en-GB',
  Malaysia: 'ms-MY',
  Maldives: 'en-GB', // no Dhivehi voice
  Mali: 'fr-FR',
  Malta: 'en-GB', // no Maltese voice; English is co-official
  'Marshall Islands': 'en-US',
  Mauritania: 'fr-FR', // Nouakchott is spelled per French transliteration
  Mauritius: 'fr-FR', // Port Louis is French-derived
  Mexico: 'es-MX',
  Moldova: 'ro-RO',
  Monaco: 'fr-FR',
  Mongolia: 'en-US', // no Mongolian voice
  Montenegro: 'hr-HR', // Latin-script Serbo-Croatian voice
  Morocco: 'ar-SA',
  Mozambique: 'pt-PT',
  Myanmar: 'en-US', // Burmese voices are rare on desktop
  Namibia: 'af-ZA', // Windhoek is an Afrikaans/German name
  Nauru: 'en-AU',
  Nepal: 'ne-NP',
  Netherlands: 'nl-NL',
  'New Caledonia': 'fr-FR',
  'New Zealand': 'en-NZ',
  Nicaragua: 'es-MX',
  Niger: 'fr-FR',
  Nigeria: 'en-GB',
  Niue: 'en-NZ',
  'North Korea': 'ko-KR',
  'North Macedonia': 'bg-BG', // Macedonian voices are rare; Bulgarian is closest
  'Northern Cyprus': 'tr-TR',
  'Northern Ireland': 'en-GB',
  Norway: 'nb-NO',
  Oman: 'ar-SA',
  Pakistan: 'ur-PK',
  Palau: 'en-US',
  Palestine: 'ar-SA',
  Panama: 'es-MX',
  'Papua New Guinea': 'en-AU',
  Paraguay: 'es-MX',
  Peru: 'es-MX',
  Philippines: 'fil-PH',
  Poland: 'pl-PL',
  Portugal: 'pt-PT',
  'Puerto Rico': 'es-MX',
  Qatar: 'ar-SA',
  'Republic of the Congo': 'fr-FR',
  Romania: 'ro-RO',
  Russia: 'ru-RU',
  Rwanda: 'fr-FR', // no Kinyarwanda voice
  'Sahrawi Arab Democratic Republic': 'ar-SA',
  'Saint Kitts and Nevis': 'en-GB',
  'Saint Lucia': 'en-GB',
  'Saint Vincent and the Grenadines': 'en-GB',
  Samoa: 'en-NZ', // no Samoan voice
  'San Marino': 'it-IT',
  'São Tomé and Príncipe': 'pt-PT',
  'Saudi Arabia': 'ar-SA',
  Scotland: 'en-GB',
  Senegal: 'fr-FR',
  Serbia: 'sr-RS',
  Seychelles: 'en-GB',
  'Sierra Leone': 'en-GB',
  Singapore: 'en-GB',
  Slovakia: 'sk-SK',
  Slovenia: 'sl-SI',
  'Solomon Islands': 'en-AU',
  Somalia: 'en-US', // no Somali voice
  Somaliland: 'en-US', // no Somali voice
  'South Africa': 'af-ZA', // Pretoria is an Afrikaans name
  'South Korea': 'ko-KR',
  'South Ossetia': 'ru-RU',
  'South Sudan': 'en-GB',
  Spain: 'es-ES',
  'Sri Lanka': 'si-LK',
  Sudan: 'ar-SA',
  Suriname: 'nl-NL',
  Sweden: 'sv-SE',
  Switzerland: 'de-DE', // Bern is in the German-speaking canton
  Syria: 'ar-SA',
  Taiwan: 'zh-TW',
  Tajikistan: 'fa-IR', // Tajik is a Persian variety
  Tanzania: 'sw-KE',
  Thailand: 'th-TH',
  'The Bahamas': 'en-GB',
  'The Gambia': 'en-GB',
  'Timor-Leste': 'pt-PT',
  Togo: 'fr-FR',
  Tonga: 'en-NZ', // no Tongan voice
  Transnistria: 'ru-RU',
  'Trinidad and Tobago': 'en-GB',
  Tunisia: 'ar-SA',
  Turkey: 'tr-TR',
  Turkmenistan: 'ru-RU', // no Turkmen voice
  Tuvalu: 'en-NZ',
  Uganda: 'en-GB',
  Ukraine: 'uk-UA',
  'United Arab Emirates': 'ar-SA',
  'United Kingdom': 'en-GB',
  'United States of America': 'en-US',
  'United States Virgin Islands': 'en-US',
  Uruguay: 'es-MX',
  Uzbekistan: 'ru-RU', // no Uzbek voice
  Vanuatu: 'en-AU',
  'Vatican City': 'it-IT',
  Venezuela: 'es-MX',
  Vietnam: 'vi-VN',
  Wales: 'en-GB', // no Welsh voice in most browsers; Cardiff reads fine in English
  Yemen: 'ar-SA',
  Zambia: 'en-GB',
  Zimbabwe: 'en-GB',
}

export const DEFAULT_LANG = 'en-US'
