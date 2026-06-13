/**
 * Type stubs for NapCatQQ plugin compatibility.
 * Provides the types that QCE plugin imports from NapCatQQ/src/core/types.js.
 */

export const ChatType = {
  Unknown: 0,
  Friend: 1,
  Group: 2,
  Temp: 3,
  Stranger: 4,
};

// RawMessage type — just a marker for TypeScript
export class RawMessage {
  constructor(data) {
    Object.assign(this, data || {});
  }
}

export class MessageElement {
  constructor(data) {
    Object.assign(this, data || {});
  }
}

export const ElementType = {
  TEXT: 1,
  PIC: 2,
  FILE: 3,
  PTT: 4,
  VIDEO: 5,
  FACE: 6,
  REPLY: 7,
  GREYTIP: 8,
  ARK: 10,
  MFACE: 11,
  MARKDOWN: 14,
  MULTIFORWARD: 16,
  SHARELOCATION: 28,
  CALENDAR: 40,
  // Also support numeric keys for reverse lookup
  1: 'TEXT',
  2: 'PIC',
  3: 'FILE',
  4: 'PTT',
  5: 'VIDEO',
  6: 'FACE',
  7: 'REPLY',
  8: 'GREYTIP',
  10: 'ARK',
  11: 'MFACE',
  14: 'MARKDOWN',
  16: 'MULTIFORWARD',
  28: 'SHARELOCATION',
  40: 'CALENDAR',
};

// Alias used by some imports
ElementType.GreyTip = ElementType.GREYTIP;

export const NTMsgType = {
  KMSGTYPEUNKNOWN: 0,
  KMSGTYPETEXT: 1,
  KMSGTYPEIMAGE: 2,
  KMSGTYPEFILE: 3,
  KMSGTYPEPTT: 4,
  KMSGTYPEVIDEO: 5,
  KMSGTYPEFACE: 6,
  KMSGTYPEREPLY: 7,
  KMSGTYPEGRAYTIPS: 8,
  KMSGTYPEWALLET: 9,
  KMSGTYPEARK: 10,
  KMSGTYPEMULTIFORWARD: 16,
  KMSGTYPEMARKDOWN: 14,
  KMSGTYPECALENDAR: 40,
  // Reverse lookup
  0: 'KMSGTYPEUNKNOWN',
  1: 'KMSGTYPETEXT',
  2: 'KMSGTYPEIMAGE',
  3: 'KMSGTYPEFILE',
  4: 'KMSGTYPEPTT',
  5: 'KMSGTYPEVIDEO',
  6: 'KMSGTYPEFACE',
  7: 'KMSGTYPEREPLY',
  8: 'KMSGTYPEGRAYTIPS',
  9: 'KMSGTYPEWALLET',
  10: 'KMSGTYPEARK',
  14: 'KMSGTYPEMARKDOWN',
  16: 'KMSGTYPEMULTIFORWARD',
  40: 'KMSGTYPECALENDAR',
};

export const SendStatus = {
  Success: 0,
  Failed: 1,
  Sending: 2,
};

export const MemberRole = {
  Member: 0,
  Admin: 1,
  Owner: 2,
};
