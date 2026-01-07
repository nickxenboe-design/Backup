import { drizzle } from "drizzle-orm/node-postgres";
import pool from "../config/postgres.js";
import * as schema from "./schema";

export const db = drizzle(pool, { schema });
