import { appSqlClient, closeAppDb, verifyRestrictedDatabaseRole } from "@predioon/db/runtime";
import { identitySqlClient, closeIdentityDb } from "@predioon/db/identity";
import { brokerAuthSqlClient, closeBrokerAuthDb } from "@predioon/db/broker-auth";

export async function assertApiDatabaseRoles(): Promise<void> {
  await Promise.all([
    verifyRestrictedDatabaseRole(appSqlClient, "predioon_app"),
    verifyRestrictedDatabaseRole(identitySqlClient, "predioon_identity"),
    verifyRestrictedDatabaseRole(brokerAuthSqlClient, "predioon_broker_auth"),
  ]);
}

export async function closeApiDatabases(): Promise<void> {
  await Promise.all([closeAppDb(), closeIdentityDb(), closeBrokerAuthDb()]);
}
