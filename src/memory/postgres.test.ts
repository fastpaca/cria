import { describe, expect, test } from "vitest";
import { PostgresStore } from "./postgres";

describe("PostgresStore", () => {
  test("rejects unsafe table names", () => {
    expect(() => new PostgresStore({ tableName: 'foo; DROP TABLE "x";' })).toThrow(
      /Invalid table name/
    );
  });

  test("accepts schema-qualified safe table names", async () => {
    const store = new PostgresStore({
      tableName: "safe_schema.cria_kv_store",
      autoCreateTable: false,
    });

    await store.end();
  });
});
