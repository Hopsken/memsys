import m0000 from "./20260914151731_fragments/migration.sql";
import m0001 from "./20260924122507_plugin_config/migration.sql";
import m0002 from "./20260927062704_fragment_log/migration.sql";
import m0003 from "./20260927110735_activity_ops/migration.sql";

export default {
  migrations: {
    "20260914151731_fragments": m0000,
    "20260924122507_plugin_config": m0001,
    "20260927062704_fragment_log": m0002,
    "20260927110735_activity_ops": m0003,
  },
};
