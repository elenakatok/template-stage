// ═══════════════════════════════════════════════════════════════════════════════
// HOW MANY STUDENTS ARE IN A GROUP — ONE DEFINITION, INCLUDING THE WORD FOR IT.
//
// ⚠ THIS FILE EXISTS BECAUSE THE PROSE DRIFTED FROM THE CODE. Play.tsx told every
// student, twice, that they would be "placed in a group of three" — inherited from a
// three-player game and never updated. GameControlStrip meanwhile had SEATS_PER_GROUP = 2
// and was computing correctly from it. The code was right and the sentence a student
// actually read was wrong, which is the worse way round: nothing failed, no test caught
// it, and it was on the screen shown before every single session.
//
// So the WORD is exported too, not just the number. A constant that only fixes the
// arithmetic leaves the sentence free to drift again the moment the group size changes.
// ═══════════════════════════════════════════════════════════════════════════════

/** Seats in one group. Must match the server's `online.seatCount`. */
export const SEATS_PER_GROUP = 2

/** The same number as English, for prose. Change both together or neither. */
export const SEATS_PER_GROUP_WORD = 'two'
