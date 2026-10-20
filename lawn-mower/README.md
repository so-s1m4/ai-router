# Robotic Lawn Mower — CCC April 2024

Completed using CCC MCP: all 7 levels, all 35 scored files accepted.

Run a solver:

```sh
node lawn-mower/solve.cjs 7 lawn-mower/level7/in_level-7_5-large.txt
```

Regenerate a level's outputs with `node lawn-mower/generate.cjs 7`.
Independently simulate every constructed path with `node lawn-mower/verify.cjs`.
Accepted outputs are in `outputs/`; platform progress is in `accepted-progress.json`.

- Level 1 counts directions.
- Level 2 computes the visited bounding rectangle.
- Level 3 checks coverage, uniqueness, bounds, and tree avoidance.
- Levels 4–6 construct paths/cycles around a single tree and splice rectangular cycles into them.
- Level 7 uses bipartite maximum flow to give every free cell degree two, then merges cycles by swapping edges across squares. Deterministic randomized retries provide alternative cycle covers if needed. This is a heuristic for arbitrary grids; all supplied cases were solved and independently validated.

Only the movement string is output. For levels 6–7, the final cell neighbors the initial cell; the closing move is omitted as required.
