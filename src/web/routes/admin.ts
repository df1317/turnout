import { Hono } from "hono";
import type { Env } from "../../index";
import type { Session } from "../middleware/session";
import { requireAdmin } from "../middleware/session";
import adminCdts from "./admin-cdts";
import adminMeetings from "./admin-meetings";
import adminOps from "./admin-ops";
import adminSettings from "./admin-settings";
import adminUsers from "./admin-users";

type Variables = { session: Session | null };

const admin = new Hono<{ Bindings: Env; Variables: Variables }>();

admin.use("*", requireAdmin());

// Domain sub-routers
admin.route("/users", adminUsers);
admin.route("/cdts", adminCdts);
admin.route("/meetings", adminMeetings);

// Operations (sync, queue-announcements, clear-db, stats)
admin.route("/", adminOps);

// Settings and Slack channel listing
admin.route("/", adminSettings);

export default admin;
