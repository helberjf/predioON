-- Persistent login admission shared by API replicas; apply atomically after 034.
CREATE TABLE IF NOT EXISTS public.auth_login_buckets (
  scope text NOT NULL CHECK (scope IN ('network','account')),
  key_hash bytea NOT NULL CHECK (octet_length(key_hash)=32),
  tokens numeric NOT NULL CHECK (tokens>=0 AND tokens<=300),
  updated_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL CHECK (expires_at>=updated_at),
  PRIMARY KEY(scope,key_hash)
);
CREATE INDEX IF NOT EXISTS auth_login_buckets_expiry_idx ON public.auth_login_buckets(expires_at);
ALTER TABLE public.auth_login_buckets ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.auth_login_buckets FROM PUBLIC,predioon_app,predioon_identity,predioon_broker_auth;

-- Private primitive: only the fixed two-bucket wrapper is available to identity.
CREATE OR REPLACE FUNCTION public.identity_consume_login_bucket(target_scope text,target_key bytea)
RETURNS integer LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE capacity integer; period_seconds integer; bucket public.auth_login_buckets%ROWTYPE;
 observed_at timestamptz; evaluated_at timestamptz; balance numeric; retry_seconds integer;
BEGIN
 IF target_key IS NULL OR octet_length(target_key)<>32 OR target_scope IS NULL THEN
   RAISE EXCEPTION 'Invalid login budget key' USING ERRCODE='22023';
 END IF;
 IF target_scope='network' THEN capacity:=300; period_seconds:=60;
 ELSIF target_scope='account' THEN capacity:=20; period_seconds:=900;
 ELSE RAISE EXCEPTION 'Invalid login budget scope' USING ERRCODE='22023'; END IF;

 observed_at:=clock_timestamp();
 INSERT INTO public.auth_login_buckets(scope,key_hash,tokens,updated_at,expires_at)
 VALUES(target_scope,target_key,capacity,observed_at,observed_at+interval '30 minutes')
 -- The no-op update obtains the existing row lock atomically. DO NOTHING then
 -- SELECT would let concurrent expiry cleanup erase the row between statements.
 ON CONFLICT(scope,key_hash) DO UPDATE SET tokens=public.auth_login_buckets.tokens
 RETURNING * INTO STRICT bucket;
 -- Conflict and row-lock waits must not freeze the refill clock. If the wall
 -- clock moves backwards, retain the last observation and report its delay too.
 observed_at:=clock_timestamp();
 evaluated_at:=greatest(observed_at,bucket.updated_at);
 balance:=least(capacity,bucket.tokens+extract(epoch FROM evaluated_at-bucket.updated_at)*capacity/period_seconds);
 IF balance>=1 THEN balance:=balance-1; retry_seconds:=0;
 ELSE retry_seconds:=greatest(1,ceil(extract(epoch FROM evaluated_at-observed_at)+(1-balance)*period_seconds/capacity)::integer);
 END IF;
 UPDATE public.auth_login_buckets SET tokens=balance,updated_at=evaluated_at,expires_at=evaluated_at+interval '30 minutes'
 WHERE scope=target_scope AND key_hash=target_key;
 RETURN retry_seconds;
END $$;
REVOKE ALL ON FUNCTION public.identity_consume_login_bucket(text,bytea) FROM PUBLIC,predioon_app,predioon_identity,predioon_broker_auth;

CREATE OR REPLACE FUNCTION public.identity_take_login_budget(network_key bytea,account_key bytea)
RETURNS integer LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE retry_seconds integer; expired_before timestamptz;
BEGIN
 IF network_key IS NULL OR account_key IS NULL OR octet_length(network_key)<>32 OR octet_length(account_key)<>32 THEN
   RAISE EXCEPTION 'Invalid login budget keys' USING ERRCODE='22023';
 END IF;
 -- Every caller locks network before account. A limited account still consumes
 -- its network token; return a decision, never throw a rollback-causing429.
 retry_seconds:=public.identity_consume_login_bucket('network',network_key);
 IF retry_seconds=0 THEN retry_seconds:=public.identity_consume_login_bucket('account',account_key); END IF;

 -- Expired buckets are already fully refilled. Bounded indexed cleanup occurs
 -- after budget locks and skips busy rows, never waits on another login's key.
 expired_before:=clock_timestamp();
 WITH expired AS (
   SELECT scope,key_hash FROM public.auth_login_buckets WHERE expires_at<expired_before
   ORDER BY expires_at LIMIT 32 FOR UPDATE SKIP LOCKED
 ) DELETE FROM public.auth_login_buckets b USING expired e WHERE b.scope=e.scope AND b.key_hash=e.key_hash;
 RETURN retry_seconds;
END $$;
REVOKE ALL ON FUNCTION public.identity_take_login_budget(bytea,bytea) FROM PUBLIC,predioon_app,predioon_broker_auth;
GRANT EXECUTE ON FUNCTION public.identity_take_login_budget(bytea,bytea) TO predioon_identity;

-- Keep ownership aligned with the existing identity authority, even when a
-- different administrative login applies this migration. Reapplication clears
-- accidental function grants before restoring only the intended entry point.
DO $$ DECLARE helper_owner text; helper regprocedure; grantee_name text; BEGIN
 SELECT pg_get_userbyid(proowner) INTO STRICT helper_owner FROM pg_proc
 WHERE oid='public.identity_lock_account_active(text)'::regprocedure;
 EXECUTE format('ALTER TABLE public.auth_login_buckets OWNER TO %I',helper_owner);
 FOR helper IN SELECT p.oid::regprocedure FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
 WHERE n.nspname='public' AND p.proname IN ('identity_take_login_budget','identity_consume_login_bucket') LOOP
   EXECUTE format('ALTER FUNCTION %s OWNER TO %I',helper,helper_owner);
   EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC',helper);
   FOR grantee_name IN SELECT DISTINCT r.rolname FROM pg_proc p CROSS JOIN LATERAL aclexplode(p.proacl) acl
     JOIN pg_roles r ON r.oid=acl.grantee WHERE p.oid=helper AND acl.grantee<>p.proowner
   LOOP EXECUTE format('REVOKE ALL ON FUNCTION %s FROM %I',helper,grantee_name); END LOOP;
 END LOOP;
 GRANT EXECUTE ON FUNCTION public.identity_take_login_budget(bytea,bytea) TO predioon_identity;
END $$;
