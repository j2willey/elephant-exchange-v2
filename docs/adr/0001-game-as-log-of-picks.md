# A Game is stored as an append-only log of Picks

A Game's record is the ordered list of everything the Host and Co-hosts did to it (Picks, Draws, Skips, roster changes, Final Round steps), not a document of current state that is overwritten on every change. The current state is rebuilt by replaying that log through a pure rules module, and cached in memory and as a snapshot. We chose this over v1's single overwritten JSON document because Undo becomes "mark the last Pick undone and replay," the whole Game can be replayed or summarized afterwards ("most-stolen Gift"), and the rules can be tested as plain functions of (state, action). Organizations, people, Themes and Posts are ordinary tables; only gameplay is a log.

## Consequences

- Every change to rules must keep old logs replayable, or snapshot finished Games before changing the rules.
- Random Draws are recorded in the log as the Player actually drawn, never re-randomized on replay.
