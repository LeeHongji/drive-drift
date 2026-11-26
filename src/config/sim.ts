// Simulation clock. The car, scoring and laps only ever advance in these fixed steps, so the same input
// sequence always gives the same result (unit tests and replays depend on this).

/** Fixed physics step, seconds. */
export const SIM_DT = 1 / 120;
/** Upper bound on physics steps per rendered frame. Beyond this the game slows down instead of spiralling. */
export const MAX_STEPS_PER_FRAME = 8;
