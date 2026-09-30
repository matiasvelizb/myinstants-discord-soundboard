import { truncate } from '../discord/builders/SoundboardView.js';

const AUTOCOMPLETE_LIMIT = 25;
const CHOICE_MAX = 100; // Discord limit for choice name and value

const COUNTRIES = {
  CL: ['🇨🇱', 'Chile'],
  MX: ['🇲🇽', 'Mexico'],
  ES: ['🇪🇸', 'España Spain'],
  AR: ['🇦🇷', 'Argentina'],
  US: ['🇺🇸', 'USA Estados Unidos'],
  BO: ['🇧🇴', 'Bolivia'],
  CO: ['🇨🇴', 'Colombia'],
  CR: ['🇨🇷', 'Costa Rica'],
  CU: ['🇨🇺', 'Cuba'],
  DO: ['🇩🇴', 'Dominicana'],
  EC: ['🇪🇨', 'Ecuador'],
  GQ: ['🇬🇶', 'Guinea Ecuatorial'],
  GT: ['🇬🇹', 'Guatemala'],
  HN: ['🇭🇳', 'Honduras'],
  NI: ['🇳🇮', 'Nicaragua'],
  PA: ['🇵🇦', 'Panama'],
  PE: ['🇵🇪', 'Peru'],
  PR: ['🇵🇷', 'Puerto Rico'],
  PY: ['🇵🇾', 'Paraguay'],
  SV: ['🇸🇻', 'El Salvador'],
  UY: ['🇺🇾', 'Uruguay'],
  VE: ['🇻🇪', 'Venezuela'],
};

// Edge Spanish voices as "<country>:<female> <male>...", in the order they are suggested
const EDGE_VOICES = [
  'CL:Catalina Lorenzo',
  'MX:Dalia Jorge',
  'ES:Elvira Ximena Alvaro',
  'AR:Elena Tomas',
  'US:Paloma Alonso',
  'BO:Sofia Marcelo',
  'CO:Salome Gonzalo',
  'CR:Maria Juan',
  'CU:Belkys Manuel',
  'DO:Ramona Emilio',
  'EC:Andrea Luis',
  'GQ:Teresa Javier',
  'GT:Marta Andres',
  'HN:Karla Carlos',
  'NI:Yolanda Federico',
  'PA:Margarita Roberto',
  'PE:Camila Alex',
  'PR:Karina Victor',
  'PY:Tania Mario',
  'SV:Lorena Rodrigo',
  'UY:Valentina Mateo',
  'VE:Paola Sebastian',
];

const normalize = (text) => text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

function makeVoice(voice, label, keywords) {
  return { ...voice, label, name: truncate(label, CHOICE_MAX), haystack: normalize(`${label} ${keywords}`) };
}

const voices = EDGE_VOICES.flatMap((entry) => {
  const [country, names] = entry.split(':');
  const [flag, countryName] = COUNTRIES[country];

  return names.split(' ').map((name) => makeVoice(
    { id: name.toLowerCase(), voice: `es-${country}-${name}Neural` },
    `${flag} ${name} · ${countryName.split(' ')[0]}`,
    `${countryName} ${country} es-${country} español spanish`,
  ));
});

/**
 * @param {string} id
 * @returns {Object|null} - { id, label, voice }
 */
export function getVoice(id) {
  return voices.find((voice) => voice.id === id) ?? null;
}

/**
 * Voices matching every word of the query, in suggestion order (all voices when empty)
 * @param {string} query
 * @param {number} [limit]
 * @returns {Object[]}
 */
export function searchVoices(query, limit = AUTOCOMPLETE_LIMIT) {
  const words = normalize(query).split(/\s+/).filter(Boolean);
  const matches = [];

  for (const voice of voices) {
    if (matches.length >= limit) break;
    if (words.every((word) => voice.haystack.includes(word))) {
      matches.push(voice);
    }
  }

  return matches;
}

/**
 * Turn a voice option value into a voice: an id picked from autocomplete, or typed text
 * @param {string} input
 * @returns {Object|null}
 */
export function resolveVoice(input) {
  const text = input.trim();
  return getVoice(text.toLowerCase()) ?? (text ? searchVoices(text, 1)[0] ?? null : null);
}

/**
 * Autocomplete choices for a voice option, with the user's current voice on top when not searching
 * @param {string} query
 * @param {Object|null} currentVoice
 * @returns {Array<{name: string, value: string}>}
 */
export function voiceChoices(query, currentVoice) {
  const matches = searchVoices(query);

  if (!query.trim() && currentVoice) {
    const rest = matches.filter((voice) => voice.id !== currentVoice.id).slice(0, AUTOCOMPLETE_LIMIT - 1);
    return [
      { name: truncate(`⭐ ${currentVoice.label}`, CHOICE_MAX), value: currentVoice.id },
      ...rest.map((voice) => ({ name: voice.name, value: voice.id })),
    ];
  }

  return matches.map((voice) => ({ name: voice.name, value: voice.id }));
}
