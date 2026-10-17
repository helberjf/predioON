// Unit suites replace every query, so the restricted pools are built but never
// connect. Import this first: it mirrors the runtime environment, which has no owner.
delete process.env.DATABASE_URL;
process.env.DATABASE_URL_INGEST ??= "postgres://predioon_ingest:unused@127.0.0.1:5436/unused";
process.env.DATABASE_URL_ACCESS_SERVICE ??= "postgres://predioon_access_service:unused@127.0.0.1:5436/unused";
