import { DROP_V33_SQL } from "./v33-downgrade.js";

export { withoutV33Columns as withoutV32Columns } from "./v33-downgrade.js";

export const DROP_V32_SQL = `${DROP_V33_SQL}
DROP TABLE worktree_checks;
`;
